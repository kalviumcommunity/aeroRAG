/**
 * ============================================================================
 * Milestone 3.25 & 3.26: Embeddings & Generating Embeddings via API
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Implements a configurable embedding adapter architecture converting chunks
 * and operational queries into normalized dense vectors, validating dimensions,
 * numeric values, and response counts, handling batching, and enforcing vector
 * space compatibility invariants.
 *
 * Safety Invariant:
 * "Never assume two embedding models share a compatible vector space."
 */

import config from '../config/env.js';
import logger from '../utils/logger.js';

// ============================================================================
// Error Hierarchy
// ============================================================================

export class EmbeddingError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category || 'GENERAL_ERROR';
    this.statusCode = options.statusCode || 500;
    this.retryable = Boolean(options.retryable);
    this.details = options.details || null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class MissingEmbeddingConfigurationError extends EmbeddingError {
  constructor(message = 'Missing embedding configuration or credentials', options = {}) {
    super(message, {
      category: 'MISSING_CONFIGURATION',
      statusCode: 400,
      retryable: false,
      details: options.details || {
        requiredEnvVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
        help: 'Provide a valid Google Gemini API key via GOOGLE_API_KEY or GEMINI_API_KEY environment variable.'
      },
      ...options
    });
  }
}

export class EmbeddingTimeoutError extends EmbeddingError {
  constructor(message = 'Embedding request timed out', options = {}) {
    super(message, {
      category: 'TIMEOUT',
      statusCode: 504,
      retryable: true,
      details: { timeoutMs: options.timeoutMs },
      ...options
    });
    this.timeoutMs = options.timeoutMs;
  }
}

export class EmbeddingRateLimitError extends EmbeddingError {
  constructor(message = 'Embedding provider rate limit or quota exceeded', options = {}) {
    super(message, {
      category: 'RATE_LIMIT',
      statusCode: 429,
      retryable: true,
      details: {
        retryAfterMs: options.retryAfterMs || 5000,
        provider: options.provider || 'gemini',
        ...options.details
      },
      ...options
    });
    this.retryAfterMs = options.retryAfterMs || 5000;
  }
}

export class EmbeddingDimensionMismatchError extends EmbeddingError {
  constructor(expected, actual, options = {}) {
    super(`Embedding dimension mismatch: expected ${expected}, got ${actual}`, {
      category: 'DIMENSION_MISMATCH',
      statusCode: 502,
      retryable: false,
      details: { expected, actual, ...options.details },
      ...options
    });
    this.expected = expected;
    this.actual = actual;
  }
}

export class EmbeddingInvalidResponseError extends EmbeddingError {
  constructor(message = 'Invalid, empty, or non-finite embedding response', options = {}) {
    super(message, {
      category: 'INVALID_RESPONSE',
      statusCode: 502,
      retryable: false,
      details: options.details || null,
      ...options
    });
  }
}

export class IncompatibleVectorSpaceError extends EmbeddingError {
  constructor(modelA, modelB, dimA, dimB, options = {}) {
    super(
      `Incompatible vector spaces: cannot compare or query vectors from different embedding models ("${modelA}" [${dimA}] vs "${modelB}" [${dimB}]).`,
      {
        category: 'INCOMPATIBLE_VECTOR_SPACE',
        statusCode: 400,
        retryable: false,
        details: { modelA, modelB, dimA, dimB, ...options.details },
        ...options
      }
    );
    this.modelA = modelA;
    this.modelB = modelB;
    this.dimA = dimA;
    this.dimB = dimB;
  }
}

export class EmbeddingProviderError extends EmbeddingError {
  constructor(message = 'Embedding provider upstream error', options = {}) {
    super(message, {
      category: 'PROVIDER_ERROR',
      statusCode: options.statusCode || 502,
      retryable: Boolean(options.retryable),
      details: options.details || null,
      ...options
    });
  }
}

// ============================================================================
// Vector Validation & Similarity Math
// ============================================================================

/**
 * Validates that an embedding vector is a valid array of finite numbers matching expected dimensions.
 *
 * @param {Array<number>} vector - The vector to validate.
 * @param {number} expectedDimensions - Expected vector length.
 * @throws {EmbeddingDimensionMismatchError|EmbeddingInvalidResponseError}
 */
export function validateEmbeddingVector(vector, expectedDimensions) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) {
    throw new EmbeddingInvalidResponseError('Embedding vector must be an array or Float32Array');
  }

  if (vector.length !== expectedDimensions) {
    throw new EmbeddingDimensionMismatchError(expectedDimensions, vector.length);
  }

  for (let i = 0; i < vector.length; i++) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || isNaN(val)) {
      throw new EmbeddingInvalidResponseError(
        `Embedding vector contains non-finite numeric value at index ${i}: ${val}`
      );
    }
  }
}

/**
 * Normalizes a vector to unit length (L2 norm = 1.0).
 *
 * @param {Array<number>} vector - Input vector.
 * @returns {Array<number>} Unit-length normalized vector.
 */
export function normalizeVector(vector) {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSquares += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0 || !Number.isFinite(norm)) {
    return Array.from(vector);
  }
  return Array.from(vector).map(v => v / norm);
}

/**
 * Verifies whether two vector metadata records belong to the same embedding vector space.
 *
 * INVARIANT: Never assume two embedding models share a compatible vector space!
 *
 * @param {Object} metaA - Metadata for vector A (model, dimensions).
 * @param {Object} metaB - Metadata for vector B (model, dimensions).
 * @returns {boolean} True if vector spaces are identical.
 */
export function isCompatibleVectorSpace(metaA = {}, metaB = {}) {
  const modelA = metaA.model || metaA.modelName || metaA.embeddingModel || null;
  const modelB = metaB.model || metaB.modelName || metaB.embeddingModel || null;
  const dimA = metaA.dimensions || metaA.dim || (metaA.vector ? metaA.vector.length : null);
  const dimB = metaB.dimensions || metaB.dim || (metaB.vector ? metaB.vector.length : null);

  if (modelA && modelB && modelA !== modelB) {
    return false;
  }
  if (dimA && dimB && dimA !== dimB) {
    return false;
  }
  return true;
}

/**
 * Calculates cosine similarity between two vectors, strictly verifying vector space compatibility.
 *
 * @param {Array<number>} vecA - Vector A.
 * @param {Array<number>} vecB - Vector B.
 * @param {Object} [metaA] - Metadata for vector A (model, dimensions).
 * @param {Object} [metaB] - Metadata for vector B (model, dimensions).
 * @returns {number} Cosine similarity between -1.0 and 1.0.
 * @throws {IncompatibleVectorSpaceError} If models or dimensions are incompatible.
 */
export function cosineSimilarity(vecA, vecB, metaA = {}, metaB = {}) {
  if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0) {
    throw new EmbeddingInvalidResponseError('Cannot calculate cosine similarity of empty vectors');
  }

  // Safety Invariant: Check vector space compatibility
  if (!isCompatibleVectorSpace(metaA, metaB) || vecA.length !== vecB.length) {
    const modelA = metaA.model || metaA.embeddingModel || 'unknown_model';
    const modelB = metaB.model || metaB.embeddingModel || 'unknown_model';
    throw new IncompatibleVectorSpaceError(modelA, modelB, vecA.length, vecB.length);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const valA = vecA[i];
    const valB = vecB[i];
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return 0;
  }

  const similarity = dotProduct / denominator;
  // Clamp floating point jitter to [-1.0, 1.0]
  return Math.max(-1.0, Math.min(1.0, Number(similarity.toFixed(6))));
}

// ============================================================================
// Abstract Base Embedding Adapter
// ============================================================================

export class BaseEmbeddingAdapter {
  constructor(options = {}) {
    this.providerName = options.provider || 'base';
    this.modelName = options.model || config.EMBEDDING_MODEL || 'text-embedding-004';
    this.dimensions = parseInt(options.dimensions || config.EMBEDDING_DIMENSION || 768, 10);
    this.batchSize = parseInt(options.batchSize || config.EMBEDDING_BATCH_SIZE || 32, 10);
    this.timeoutMs = parseInt(options.timeoutMs || config.EMBEDDING_TIMEOUT_MS || 30000, 10);
  }

  /**
   * Embeds a single query string.
   *
   * @param {string} text - Query text.
   * @returns {Promise<Object>} Embedding record with vector and model identity metadata.
   */
  async embedQuery(text) {
    throw new Error('embedQuery must be implemented by subclass');
  }

  /**
   * Embeds a batch of text strings.
   *
   * @param {Array<string>} texts - Texts to embed.
   * @param {Object} [options] - Options (batchSize).
   * @returns {Promise<Array<Object>>} Array of embedding records.
   */
  async embedBatch(texts, options = {}) {
    throw new Error('embedBatch must be implemented by subclass');
  }

  /**
   * Enriches an array of chunk records with embeddings and model identity metadata.
   *
   * @param {Array<Object>} chunks - Array of chunk records from chunker.js.
   * @param {Object} [options] - Ingestion options.
   * @returns {Promise<Array<Object>>} Enriched chunks.
   */
  async embedChunks(chunks = [], options = {}) {
    if (!Array.isArray(chunks) || chunks.length === 0) return [];

    const texts = chunks.map(c => c.text);
    const results = await this.embedBatch(texts, options);

    return chunks.map((chunk, idx) => {
      const embRecord = results[idx];
      return {
        ...chunk,
        embedding: embRecord.vector,
        metadata: {
          ...chunk.metadata,
          embeddingModel: embRecord.model,
          embeddingDimensions: embRecord.dimensions,
          embeddingProvider: embRecord.provider,
          embeddingGeneratedAt: embRecord.generatedAt
        }
      };
    });
  }
}

// ============================================================================
// High-Fidelity Mock Embedding Adapter (100% Offline)
// ============================================================================

export class MockEmbeddingAdapter extends BaseEmbeddingAdapter {
  constructor(options = {}) {
    super({
      provider: 'mock',
      model: options.model || 'mock-text-embedding-004',
      dimensions: options.dimensions || config.EMBEDDING_DIMENSION || 768,
      batchSize: options.batchSize || config.EMBEDDING_BATCH_SIZE || 32,
      ...options
    });
    this.simulatedError = options.simulatedError || null;
  }

  /**
   * Generates a deterministic pseudo-semantic embedding vector from input text.
   * Words sharing semantic terms map to similar coordinates, providing realistic
   * cosine similarity behavior for synthetic testing.
   */
  _generateMockVector(text) {
    const vector = new Float32Array(this.dimensions);
    const clean = (text || '').toLowerCase();
    const tokens = clean.split(/[\s,.:;!?"'()\-_]+/).filter(Boolean);
    const stopWords = new Set(['the', 'and', 'to', 'of', 'a', 'in', 'is', 'for', 'on', 'are', 'be', 'at', 'by', 'do', 'how']);

    for (const token of tokens) {
      if (token.length < 2) continue;
      const weight = stopWords.has(token) ? 0.2 : 3.0;

      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash * 31 + token.charCodeAt(i)) | 0;
      }
      const primaryIdx = Math.abs(hash) % this.dimensions;
      const secondaryIdx = Math.abs((hash >> 8) * 17) % this.dimensions;

      vector[primaryIdx] += weight;
      vector[secondaryIdx] += weight * 0.5;
    }

    const normalized = normalizeVector(Array.from(vector));
    validateEmbeddingVector(normalized, this.dimensions);
    return normalized;
  }

  async embedQuery(text) {
    if (this.simulatedError) {
      throw this.simulatedError;
    }

    const trimmed = (text || '').trim();
    if (!trimmed) {
      throw new EmbeddingInvalidResponseError('Cannot embed empty or whitespace query');
    }

    const vector = this._generateMockVector(trimmed);

    return {
      vector,
      dimensions: this.dimensions,
      model: this.modelName,
      provider: this.providerName,
      generatedAt: new Date().toISOString()
    };
  }

  async embedBatch(texts = [], options = {}) {
    if (this.simulatedError) {
      throw this.simulatedError;
    }

    if (!Array.isArray(texts)) {
      throw new EmbeddingInvalidResponseError('embedBatch input must be an array of strings');
    }

    const batchSize = options.batchSize || this.batchSize;
    const results = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      for (const t of slice) {
        const trimmed = (t || '').trim() || 'empty';
        const vector = this._generateMockVector(trimmed);
        results.push({
          vector,
          dimensions: this.dimensions,
          model: this.modelName,
          provider: this.providerName,
          generatedAt: new Date().toISOString()
        });
      }
    }

    if (results.length !== texts.length) {
      throw new EmbeddingInvalidResponseError(
        `Batch embedding count mismatch: expected ${texts.length}, got ${results.length}`
      );
    }

    return results;
  }
}

// ============================================================================
// Google Gemini Embedding Adapter (text-embedding-004)
// ============================================================================

export class GeminiEmbeddingAdapter extends BaseEmbeddingAdapter {
  constructor(options = {}) {
    super({
      provider: 'gemini',
      model: options.model || config.EMBEDDING_MODEL || 'text-embedding-004',
      dimensions: options.dimensions || config.EMBEDDING_DIMENSION || 768,
      batchSize: options.batchSize || config.EMBEDDING_BATCH_SIZE || 32,
      timeoutMs: options.timeoutMs || config.EMBEDDING_TIMEOUT_MS || 30000,
      ...options
    });

    this.apiKey = options.apiKey !== undefined
      ? options.apiKey
      : (config.GOOGLE_API_KEY || config.GEMINI_API_KEY);
    if (!this.apiKey) {
      throw new MissingEmbeddingConfigurationError();
    }
  }

  async _getGenAI() {
    try {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      return new GoogleGenerativeAI(this.apiKey);
    } catch (err) {
      throw new EmbeddingProviderError(
        `Failed to initialize @google/generative-ai SDK: ${err.message}`,
        { details: { cause: err.message } }
      );
    }
  }

  async embedQuery(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      throw new EmbeddingInvalidResponseError('Cannot embed empty or whitespace query');
    }

    const genAI = await this._getGenAI();
    const model = genAI.getGenerativeModel({ model: this.modelName });

    try {
      const result = await Promise.race([
        model.embedContent(trimmed),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new EmbeddingTimeoutError(`Embedding timed out after ${this.timeoutMs}ms`, { timeoutMs: this.timeoutMs })),
            this.timeoutMs
          )
        )
      ]);

      if (!result || !result.embedding || !result.embedding.values) {
        throw new EmbeddingInvalidResponseError('Gemini API returned malformed or empty embedding structure');
      }

      const rawVector = result.embedding.values;
      validateEmbeddingVector(rawVector, this.dimensions);
      const vector = normalizeVector(rawVector);

      return {
        vector,
        dimensions: this.dimensions,
        model: this.modelName,
        provider: this.providerName,
        generatedAt: new Date().toISOString()
      };
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      if (err.message && err.message.includes('429')) {
        throw new EmbeddingRateLimitError(err.message, { provider: 'gemini' });
      }
      throw new EmbeddingProviderError(`Gemini embedding failed: ${err.message}`, { details: { cause: err.message } });
    }
  }

  async embedBatch(texts = [], options = {}) {
    if (!Array.isArray(texts)) {
      throw new EmbeddingInvalidResponseError('embedBatch input must be an array of strings');
    }

    const batchSize = options.batchSize || this.batchSize;
    const allResults = [];
    const genAI = await this._getGenAI();
    const model = genAI.getGenerativeModel({ model: this.modelName });

    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const requests = slice.map(t => ({
        content: { parts: [{ text: (t || '').trim() || ' ' }] }
      }));

      try {
        const batchResult = await Promise.race([
          model.batchEmbedContents({ requests }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new EmbeddingTimeoutError(`Batch embedding timed out after ${this.timeoutMs}ms`, { timeoutMs: this.timeoutMs })),
              this.timeoutMs
            )
          )
        ]);

        if (!batchResult || !batchResult.embeddings || !Array.isArray(batchResult.embeddings)) {
          throw new EmbeddingInvalidResponseError('Gemini API returned invalid batchEmbedContents payload');
        }

        if (batchResult.embeddings.length !== slice.length) {
          throw new EmbeddingInvalidResponseError(
            `Batch size mismatch: expected ${slice.length} embeddings, got ${batchResult.embeddings.length}`
          );
        }

        for (const emb of batchResult.embeddings) {
          const rawVector = emb.values;
          validateEmbeddingVector(rawVector, this.dimensions);
          const vector = normalizeVector(rawVector);
          allResults.push({
            vector,
            dimensions: this.dimensions,
            model: this.modelName,
            provider: this.providerName,
            generatedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        if (err instanceof EmbeddingError) throw err;
        if (err.message && err.message.includes('429')) {
          throw new EmbeddingRateLimitError(err.message, { provider: 'gemini' });
        }
        throw new EmbeddingProviderError(`Gemini batch embedding failed: ${err.message}`, { details: { cause: err.message } });
      }
    }

    return allResults;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a configured embedding adapter instance based on environment or parameters.
 *
 * @param {Object} [options] - Configuration options.
 * @param {string} [options.provider] - 'gemini' | 'mock'.
 * @param {boolean} [options.mock] - Explicitly force mock adapter.
 * @returns {BaseEmbeddingAdapter} Initialized embedding adapter.
 */
export function createEmbeddingAdapter(options = {}) {
  const isMock = Boolean(
    options.mock ||
    config.DEMO_MODE ||
    options.provider === 'mock' ||
    config.EMBEDDING_PROVIDER === 'mock' ||
    (!config.GOOGLE_API_KEY && !config.GEMINI_API_KEY && !options.apiKey)
  );

  if (isMock) {
    return new MockEmbeddingAdapter(options);
  }

  return new GeminiEmbeddingAdapter(options);
}
