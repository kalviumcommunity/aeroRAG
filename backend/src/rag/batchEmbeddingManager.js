/**
 * ============================================================================
 * Milestone 3.28: Batch Embedding, Rate Limiting & Cost Management
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Implements resilient batch embedding ingestion with configurable batch sizes,
 * bounded retries with exponential backoff and jitter, error classification
 * (transient vs permanent), partial batch failure isolation, idempotent caching
 * via stable content/model hashes, and actual vs estimated usage accounting.
 */

import crypto from 'crypto';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { estimateTokenCountSync } from './tokenContextManager.js';
import {
  createEmbeddingAdapter,
  BaseEmbeddingAdapter,
  EmbeddingError,
  EmbeddingRateLimitError,
  EmbeddingTimeoutError,
  MissingEmbeddingConfigurationError,
  EmbeddingDimensionMismatchError,
  EmbeddingInvalidResponseError,
  IncompatibleVectorSpaceError
} from './embeddingAdapter.js';

// ============================================================================
// Error Classification & Backoff Math
// ============================================================================

export class EmbeddingAuthenticationError extends EmbeddingError {
  constructor(message = 'Embedding provider authentication failed (invalid API key or unauthorized)', options = {}) {
    super(message, {
      category: 'AUTHENTICATION_ERROR',
      statusCode: 401,
      retryable: false,
      ...options
    });
  }
}

export class BatchEmbeddingExhaustedRetriesError extends EmbeddingError {
  constructor(message, options = {}) {
    super(message, {
      category: 'EXHAUSTED_RETRIES',
      statusCode: 502,
      retryable: false,
      details: options.details || {},
      ...options
    });
  }
}

/**
 * Determines whether an embedding error is transient (retryable) or permanent.
 *
 * Permanent errors (validation, auth 401/403, dimension mismatch) MUST NOT be retried!
 *
 * @param {Error} error - The caught error.
 * @returns {boolean} True if transient/retryable, false if permanent.
 */
export function isRetryableEmbeddingError(error) {
  if (!error) return false;

  // Explicit retryable flag on custom error
  if (typeof error.retryable === 'boolean') {
    return error.retryable;
  }

  // Check HTTP status codes
  const status = error.statusCode || error.status;
  if (status === 429 || status === 503 || status === 504 || status === 502) {
    return true;
  }
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    return false;
  }

  // Check specific error types
  if (
    error instanceof MissingEmbeddingConfigurationError ||
    error instanceof EmbeddingDimensionMismatchError ||
    error instanceof EmbeddingInvalidResponseError ||
    error instanceof IncompatibleVectorSpaceError ||
    error instanceof EmbeddingAuthenticationError
  ) {
    return false;
  }

  if (error instanceof EmbeddingRateLimitError || error instanceof EmbeddingTimeoutError) {
    return true;
  }

  // Check network error codes
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  return false;
}

/**
 * Computes backoff delay with exponential scaling and full jitter.
 *
 * @param {number} attempt - 0-based retry attempt count (0, 1, 2...).
 * @param {Object} [options] - Backoff configuration.
 * @param {number} [options.initialBackoffMs=500] - Base delay for attempt 0.
 * @param {number} [options.maxBackoffMs=30000] - Ceiling delay in ms.
 * @param {number} [options.backoffMultiplier=2] - Exponential growth factor.
 * @param {boolean} [options.jitter=true] - Apply full jitter.
 * @param {number} [options.retryAfterMs] - Provider-specified retry duration.
 * @returns {number} Backoff delay in milliseconds.
 */
export function calculateBackoffWithJitter(attempt, options = {}) {
  if (typeof options.retryAfterMs === 'number' && options.retryAfterMs > 0) {
    return options.retryAfterMs;
  }

  const initialMs = options.initialBackoffMs !== undefined ? options.initialBackoffMs : 500;
  const maxMs = options.maxBackoffMs !== undefined ? options.maxBackoffMs : 30000;
  const multiplier = options.backoffMultiplier !== undefined ? options.backoffMultiplier : 2.0;
  const useJitter = options.jitter !== false;

  const rawBackoff = Math.min(maxMs, initialMs * Math.pow(multiplier, attempt));

  if (!useJitter) {
    return Math.round(rawBackoff);
  }

  // Full Jitter: Uniform random between 0 and rawBackoff
  return Math.round(Math.random() * rawBackoff);
}

/**
 * Generates a stable content/model hash to uniquely identify an embedding.
 *
 * @param {string} text - Input text.
 * @param {string} modelName - Embedding model name.
 * @param {number} dimensions - Embedding dimensions.
 * @returns {string} SHA-256 hex digest.
 */
export function computeEmbeddingCacheKey(text, modelName, dimensions) {
  const normalized = (text || '').trim();
  return crypto
    .createHash('sha256')
    .update(`${modelName}:${dimensions}:${normalized}`)
    .digest('hex');
}

// ============================================================================
// Resilient Batch Embedding Manager
// ============================================================================

export class BatchEmbeddingManager {
  /**
   * @param {Object} [options] - Configuration options.
   * @param {BaseEmbeddingAdapter} [options.adapter] - Underlying embedding adapter.
   * @param {number} [options.batchSize=32] - Number of texts per batch request.
   * @param {number} [options.maxRetries=3] - Maximum retries for transient errors.
   * @param {number} [options.initialBackoffMs=500] - Initial retry backoff.
   * @param {number} [options.maxBackoffMs=30000] - Maximum retry backoff.
   * @param {number} [options.backoffMultiplier=2.0] - Exponential backoff multiplier.
   * @param {boolean} [options.jitter=true] - Apply full jitter.
   * @param {Function} [options.sleepFn] - Async sleep function (for test injection).
   * @param {string} [options.partialFailureMode='fail_batch'] - 'fail_batch' | 'isolate_subbatch' | 'permissive'.
   * @param {boolean} [options.enableCache=true] - Cache embeddings to avoid duplicate work.
   * @param {Object} [options.pricing] - Optional pricing configuration { inputCostPerM: number }.
   */
  constructor(options = {}) {
    this.adapter = options.adapter || createEmbeddingAdapter(options);
    this.batchSize = Math.max(1, parseInt(options.batchSize || config.EMBEDDING_BATCH_SIZE || 32, 10));
    this.maxRetries = Math.max(0, parseInt(options.maxRetries !== undefined ? options.maxRetries : 3, 10));
    this.initialBackoffMs = options.initialBackoffMs !== undefined ? options.initialBackoffMs : 500;
    this.maxBackoffMs = options.maxBackoffMs !== undefined ? options.maxBackoffMs : 30000;
    this.backoffMultiplier = options.backoffMultiplier !== undefined ? options.backoffMultiplier : 2.0;
    this.jitter = options.jitter !== false;
    this.sleepFn = options.sleepFn || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    this.partialFailureMode = options.partialFailureMode || 'fail_batch';
    this.enableCache = options.enableCache !== false;

    // Pricing configuration (USD per 1,000,000 tokens)
    this.pricing = options.pricing || (
      config.LLM_INPUT_COST_PER_M ? { inputCostPerM: config.LLM_INPUT_COST_PER_M } : null
    );

    // In-memory cache: cacheKey -> Embedding Record
    this.cache = new Map();

    // Cumulative usage accounting
    this.accounting = {
      totalRequests: 0,
      totalRetries: 0,
      totalTexts: 0,
      cacheHits: 0,
      cacheMisses: 0,
      totalTokens: 0,
      isEstimated: false,
      costUsd: null,
      pricingAvailable: Boolean(this.pricing && typeof this.pricing.inputCostPerM === 'number')
    };
  }

  /**
   * Resets the cache and usage accounting statistics.
   */
  reset() {
    this.cache.clear();
    this.accounting.totalRequests = 0;
    this.accounting.totalRetries = 0;
    this.accounting.totalTexts = 0;
    this.accounting.cacheHits = 0;
    this.accounting.cacheMisses = 0;
    this.accounting.totalTokens = 0;
    this.accounting.isEstimated = false;
    this.accounting.costUsd = null;
  }

  /**
   * Clears the in-memory embedding cache only.
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Gets the number of cached embedding vectors.
   */
  getCacheSize() {
    return this.cache.size;
  }

  /**
   * Embeds a single batch with bounded retries, exponential backoff, and jitter.
   *
   * @param {Array<string>} batchTexts - Array of strings in this batch.
   * @param {number} batchIndex - Index of current batch for logging.
   * @returns {Promise<Array<Object>>} Embedding records for the batch.
   */
  async _embedBatchWithRetry(batchTexts, batchIndex = 0) {
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        this.accounting.totalRequests++;
        const results = await this.adapter.embedBatch(batchTexts, { batchSize: batchTexts.length });
        return results;
      } catch (err) {
        const retryable = isRetryableEmbeddingError(err);

        // Permanent errors (validation, dimension mismatch, auth) fail immediately!
        if (!retryable) {
          logger.warn(`[Batch ${batchIndex}] Permanent error on attempt ${attempt}: ${err.message}. Aborting retries.`);
          throw err;
        }

        // Check if retry quota is exhausted
        if (attempt >= this.maxRetries) {
          logger.error(`[Batch ${batchIndex}] Exhausted all ${this.maxRetries} retries. Last error: ${err.message}`);
          throw new BatchEmbeddingExhaustedRetriesError(
            `Batch ${batchIndex} failed after ${this.maxRetries} retries: ${err.message}`,
            { details: { batchIndex, attempts: attempt + 1, lastError: err.message } }
          );
        }

        // Transient error: compute backoff with jitter and retry
        this.accounting.totalRetries++;
        const retryAfterMs = err.retryAfterMs;
        const delayMs = calculateBackoffWithJitter(attempt, {
          initialBackoffMs: this.initialBackoffMs,
          maxBackoffMs: this.maxBackoffMs,
          backoffMultiplier: this.backoffMultiplier,
          jitter: this.jitter,
          retryAfterMs
        });

        logger.info(
          `[Batch ${batchIndex}] Transient error (${err.category || err.message}). Retrying in ${delayMs}ms (attempt ${attempt + 1}/${this.maxRetries})...`
        );

        await this.sleepFn(delayMs);
        attempt++;
      }
    }
  }

  /**
   * Embeds an array of text strings with batching, retries, caching, and usage tracking.
   *
   * @param {Array<string>} texts - Texts to embed.
   * @param {Object} [options] - Overrides for this run.
   * @returns {Promise<Object>} Processed embeddings DTO with usage and audit details.
   */
  async embedTexts(texts = [], options = {}) {
    const startTime = Date.now();
    if (!Array.isArray(texts)) {
      throw new EmbeddingInvalidResponseError('embedTexts requires an array of strings');
    }

    const batchSize = Math.max(1, parseInt(options.batchSize || this.batchSize, 10));
    const modelName = this.adapter.modelName;
    const dimensions = this.adapter.dimensions;
    const finalResults = new Array(texts.length);
    const failures = [];

    let runTokens = 0;
    let runEstimated = false;
    let cacheHitsThisRun = 0;
    let cacheMissesThisRun = 0;

    // 1. Check cache for each text
    const uncachedItems = []; // Array of { originalIndex, text }

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const trimmed = (text || '').trim();

      if (!trimmed) {
        failures.push({
          index: i,
          text: '',
          error: 'Cannot embed empty or whitespace text'
        });
        continue;
      }

      const cacheKey = computeEmbeddingCacheKey(trimmed, modelName, dimensions);

      if (this.enableCache && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        finalResults[i] = {
          ...cached,
          isFromCache: true
        };
        cacheHitsThisRun++;
        this.accounting.cacheHits++;
      } else {
        uncachedItems.push({ originalIndex: i, text: trimmed, cacheKey });
      }
    }

    cacheMissesThisRun = uncachedItems.length;
    this.accounting.cacheMisses += cacheMissesThisRun;
    this.accounting.totalTexts += texts.length;

    // 2. Process uncached items in configurable batches
    for (let b = 0; b < uncachedItems.length; b += batchSize) {
      const batchSlice = uncachedItems.slice(b, b + batchSize);
      const batchTexts = batchSlice.map(item => item.text);
      const batchIdx = Math.floor(b / batchSize);

      try {
        const batchVectors = await this._embedBatchWithRetry(batchTexts, batchIdx);

        for (let j = 0; j < batchSlice.length; j++) {
          const item = batchSlice[j];
          const embRecord = batchVectors[j];

          // Cache the result
          if (this.enableCache) {
            this.cache.set(item.cacheKey, embRecord);
          }

          finalResults[item.originalIndex] = {
            ...embRecord,
            isFromCache: false
          };

          // Token accounting
          if (embRecord.usage && typeof embRecord.usage.totalTokens === 'number') {
            runTokens += embRecord.usage.totalTokens;
            if (embRecord.usage.isEstimated) runEstimated = true;
          } else {
            runTokens += estimateTokenCountSync(item.text);
            runEstimated = true;
          }
        }
      } catch (batchErr) {
        // Handle failed batch according to partialFailureMode
        if (this.partialFailureMode === 'isolate_subbatch' && batchTexts.length > 1) {
          logger.warn(`[Batch ${batchIdx}] Retrying items individually to isolate failure...`);
          for (const item of batchSlice) {
            try {
              const singleVec = await this._embedBatchWithRetry([item.text], `iso_${item.originalIndex}`);
              const embRecord = singleVec[0];
              if (this.enableCache) this.cache.set(item.cacheKey, embRecord);
              finalResults[item.originalIndex] = { ...embRecord, isFromCache: false };
              runTokens += estimateTokenCountSync(item.text);
              runEstimated = true;
            } catch (singleErr) {
              failures.push({
                index: item.originalIndex,
                text: item.text.substring(0, 80),
                error: singleErr.message
              });
            }
          }
        } else if (this.partialFailureMode === 'permissive') {
          for (const item of batchSlice) {
            failures.push({
              index: item.originalIndex,
              text: item.text.substring(0, 80),
              error: batchErr.message
            });
          }
        } else {
          // 'fail_batch' (default): Bubble up the error to stop further corrupted batches
          throw batchErr;
        }
      }
    }

    // 3. Update cumulative accounting
    this.accounting.totalTokens += runTokens;
    if (runEstimated) this.accounting.isEstimated = true;

    let runCost = null;
    if (this.accounting.pricingAvailable && this.pricing?.inputCostPerM) {
      runCost = Number(((runTokens / 1000000) * this.pricing.inputCostPerM).toFixed(6));
      this.accounting.costUsd = Number(
        (((this.accounting.totalTokens / 1000000) * this.pricing.inputCostPerM)).toFixed(6)
      );
    }

    const durationMs = Date.now() - startTime;
    const successCount = finalResults.filter(Boolean).length;

    return {
      embeddings: finalResults,
      summary: {
        totalTexts: texts.length,
        successCount,
        failureCount: failures.length,
        cacheHits: cacheHitsThisRun,
        cacheMisses: cacheMissesThisRun,
        retriesAttempted: this.accounting.totalRetries,
        durationMs
      },
      usage: {
        totalTokens: runTokens,
        isEstimated: runEstimated,
        pricingAvailable: this.accounting.pricingAvailable,
        costUsd: runCost
      },
      failures
    };
  }

  /**
   * Enriches an array of chunk records with embeddings, model identity, and usage telemetry.
   *
   * @param {Array<Object>} chunks - Array of chunk records from chunker.js.
   * @param {Object} [options] - Ingestion configuration options.
   * @returns {Promise<Object>} Enriched chunks and execution report.
   */
  async embedChunks(chunks = [], options = {}) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      return {
        chunks: [],
        summary: { totalTexts: 0, successCount: 0, failureCount: 0, cacheHits: 0, cacheMisses: 0 },
        usage: { totalTokens: 0, isEstimated: false, pricingAvailable: false, costUsd: null },
        failures: []
      };
    }

    const texts = chunks.map(c => c.text);
    const res = await this.embedTexts(texts, options);

    const enrichedChunks = chunks.map((chunk, idx) => {
      const embRecord = res.embeddings[idx];
      if (!embRecord) {
        return {
          ...chunk,
          embedding: null,
          metadata: {
            ...chunk.metadata,
            embeddingFailed: true
          }
        };
      }

      return {
        ...chunk,
        embedding: embRecord.vector,
        metadata: {
          ...chunk.metadata,
          embeddingModel: embRecord.model,
          embeddingDimensions: embRecord.dimensions,
          embeddingProvider: embRecord.provider,
          embeddingGeneratedAt: embRecord.generatedAt,
          embeddingCached: Boolean(embRecord.isFromCache)
        }
      };
    });

    return {
      chunks: enrichedChunks,
      summary: res.summary,
      usage: res.usage,
      failures: res.failures
    };
  }

  /**
   * Returns current cumulative usage and cost accounting report.
   */
  getUsageReport() {
    return {
      ...this.accounting,
      cachedVectors: this.cache.size
    };
  }
}

/**
 * Convenience factory to create a BatchEmbeddingManager.
 *
 * @param {Object} [options] - Configuration options.
 * @returns {BatchEmbeddingManager} Initialized batch embedding manager.
 */
export function createBatchEmbeddingManager(options = {}) {
  return new BatchEmbeddingManager(options);
}
