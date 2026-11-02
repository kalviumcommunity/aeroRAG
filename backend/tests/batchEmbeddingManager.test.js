/**
 * ============================================================================
 * Milestone 3.28: Batch Embedding, Rate Limiting & Cost Management Tests
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BatchEmbeddingManager,
  createBatchEmbeddingManager,
  isRetryableEmbeddingError,
  calculateBackoffWithJitter,
  computeEmbeddingCacheKey,
  EmbeddingAuthenticationError,
  BatchEmbeddingExhaustedRetriesError
} from '../src/rag/batchEmbeddingManager.js';

import {
  MockEmbeddingAdapter,
  EmbeddingRateLimitError,
  EmbeddingTimeoutError,
  EmbeddingDimensionMismatchError,
  EmbeddingInvalidResponseError
} from '../src/rag/embeddingAdapter.js';

test('Milestone 3.28: Batch Embedding, Rate Limiting & Cost Management', async (t) => {

  await t.test('Error Classification: Transient vs Permanent', async (t2) => {
    await t2.test('should identify transient rate limits, timeouts, and network glitches as retryable', () => {
      assert.equal(isRetryableEmbeddingError(new EmbeddingRateLimitError('Rate limited')), true);
      assert.equal(isRetryableEmbeddingError(new EmbeddingTimeoutError('Timed out')), true);
      assert.equal(isRetryableEmbeddingError({ statusCode: 429 }), true);
      assert.equal(isRetryableEmbeddingError({ statusCode: 503 }), true);
      assert.equal(isRetryableEmbeddingError({ statusCode: 504 }), true);
      assert.equal(isRetryableEmbeddingError({ code: 'ECONNRESET' }), true);
      assert.equal(isRetryableEmbeddingError({ code: 'ETIMEDOUT' }), true);
    });

    await t2.test('SAFETY INVARIANT: should identify validation, auth, and dimension mismatches as non-retryable permanent errors', () => {
      assert.equal(isRetryableEmbeddingError(new EmbeddingAuthenticationError('Bad API key')), false);
      assert.equal(isRetryableEmbeddingError(new EmbeddingDimensionMismatchError(768, 512)), false);
      assert.equal(isRetryableEmbeddingError(new EmbeddingInvalidResponseError('NaN in vector')), false);
      assert.equal(isRetryableEmbeddingError({ statusCode: 400 }), false);
      assert.equal(isRetryableEmbeddingError({ statusCode: 401 }), false);
      assert.equal(isRetryableEmbeddingError({ statusCode: 403 }), false);
    });
  });

  await t.test('Exponential Backoff with Jitter Calculation', async (t2) => {
    await t2.test('should calculate exponentially increasing delay bounds', () => {
      const delay0 = calculateBackoffWithJitter(0, { initialBackoffMs: 100, backoffMultiplier: 2, jitter: false });
      const delay1 = calculateBackoffWithJitter(1, { initialBackoffMs: 100, backoffMultiplier: 2, jitter: false });
      const delay2 = calculateBackoffWithJitter(2, { initialBackoffMs: 100, backoffMultiplier: 2, jitter: false });

      assert.equal(delay0, 100);
      assert.equal(delay1, 200);
      assert.equal(delay2, 400);
    });

    await t2.test('should cap backoff at maxBackoffMs ceiling', () => {
      const delayMax = calculateBackoffWithJitter(10, {
        initialBackoffMs: 100,
        maxBackoffMs: 1000,
        backoffMultiplier: 2,
        jitter: false
      });
      assert.equal(delayMax, 1000);
    });

    await t2.test('should prioritize provider-specified retryAfterMs when present', () => {
      const delay = calculateBackoffWithJitter(0, {
        initialBackoffMs: 100,
        retryAfterMs: 4500
      });
      assert.equal(delay, 4500);
    });

    await t2.test('should apply jitter within [0, rawBackoff] bounds when jitter is enabled', () => {
      for (let i = 0; i < 20; i++) {
        const jittered = calculateBackoffWithJitter(2, {
          initialBackoffMs: 100,
          backoffMultiplier: 2,
          jitter: true
        });
        assert.ok(jittered >= 0 && jittered <= 400, `Jittered delay (${jittered}) must be between 0 and 400`);
      }
    });
  });

  await t.test('Configurable Batch Sizing & Ingestion', async (t2) => {
    await t2.test('should partition inputs into batches according to configured batchSize', async () => {
      let batchCalls = 0;
      class BatchTrackingAdapter extends MockEmbeddingAdapter {
        async embedBatch(texts, options = {}) {
          batchCalls++;
          return super.embedBatch(texts, options);
        }
      }

      const manager = new BatchEmbeddingManager({
        adapter: new BatchTrackingAdapter(),
        batchSize: 3,
        enableCache: false
      });

      const texts = [
        'Procedure 1', 'Procedure 2', 'Procedure 3',
        'Procedure 4', 'Procedure 5', 'Procedure 6',
        'Procedure 7', 'Procedure 8'
      ];

      const res = await manager.embedTexts(texts);

      assert.equal(res.summary.totalTexts, 8);
      assert.equal(res.summary.successCount, 8);
      assert.equal(res.embeddings.length, 8);
      // 8 items with batchSize 3 = 3 batches (3, 3, 2)
      assert.equal(batchCalls, 3);
    });

    await t2.test('should decorate chunks with embeddings and model metadata', async () => {
      const manager = new BatchEmbeddingManager({
        adapter: new MockEmbeddingAdapter({ model: 'text-embedding-004-batch' }),
        batchSize: 2
      });

      const chunks = [
        { id: 'c1', text: 'Sterile cockpit procedure', metadata: { page: 1 } },
        { id: 'c2', text: 'Engine start checklist', metadata: { page: 2 } }
      ];

      const res = await manager.embedChunks(chunks);

      assert.equal(res.chunks.length, 2);
      assert.equal(res.chunks[0].embedding.length, 768);
      assert.equal(res.chunks[0].metadata.embeddingModel, 'text-embedding-004-batch');
      assert.equal(res.chunks[0].metadata.page, 1);
      assert.ok(res.chunks[0].metadata.embeddingGeneratedAt);
    });
  });

  await t.test('Rate Limit & Transient Error Recovery with Retries', async (t2) => {
    await t2.test('should retry on rate limit (429) with backoff and succeed when transient error clears', async () => {
      let attempts = 0;
      const sleepDelays = [];

      class FlakyRateLimitAdapter extends MockEmbeddingAdapter {
        async embedBatch(texts, options = {}) {
          attempts++;
          if (attempts <= 2) {
            throw new EmbeddingRateLimitError('Rate limit exceeded', { retryAfterMs: 50 });
          }
          return super.embedBatch(texts, options);
        }
      }

      const manager = new BatchEmbeddingManager({
        adapter: new FlakyRateLimitAdapter(),
        maxRetries: 3,
        initialBackoffMs: 20,
        sleepFn: async (ms) => sleepDelays.push(ms),
        enableCache: false
      });

      const res = await manager.embedTexts(['Altitude alert procedure']);

      assert.equal(res.summary.successCount, 1);
      assert.equal(attempts, 3); // 2 failures + 1 success
      assert.equal(res.summary.retriesAttempted, 2);
      assert.equal(sleepDelays.length, 2);
      assert.equal(sleepDelays[0], 50); // Respected retryAfterMs
    });

    await t2.test('should abort and throw BatchEmbeddingExhaustedRetriesError when transient error persists beyond maxRetries', async () => {
      class PersistentErrorAdapter extends MockEmbeddingAdapter {
        async embedBatch() {
          throw new EmbeddingTimeoutError('Upstream network timeout');
        }
      }

      const manager = new BatchEmbeddingManager({
        adapter: new PersistentErrorAdapter(),
        maxRetries: 2,
        initialBackoffMs: 1,
        sleepFn: async () => {},
        enableCache: false
      });

      await assert.rejects(
        async () => await manager.embedTexts(['Sample procedure']),
        (err) => err instanceof BatchEmbeddingExhaustedRetriesError && err.statusCode === 502
      );
    });
  });

  await t.test('SAFETY INVARIANT: Permanent Errors Abort Immediately Without Retries', async (t2) => {
    await t2.test('should fail immediately on authentication error without wasting retries', async () => {
      let callCount = 0;
      let sleepCalls = 0;

      class UnauthorizedAdapter extends MockEmbeddingAdapter {
        async embedBatch() {
          callCount++;
          throw new EmbeddingAuthenticationError('Invalid Google Gemini API key');
        }
      }

      const manager = new BatchEmbeddingManager({
        adapter: new UnauthorizedAdapter(),
        maxRetries: 5,
        sleepFn: async () => sleepCalls++,
        enableCache: false
      });

      await assert.rejects(
        async () => await manager.embedTexts(['Emergency checklist']),
        (err) => err instanceof EmbeddingAuthenticationError && err.statusCode === 401
      );

      // Must fail on attempt 0 without retrying!
      assert.equal(callCount, 1);
      assert.equal(sleepCalls, 0);
    });

    await t2.test('should fail immediately on vector dimension mismatch without retrying', async () => {
      let callCount = 0;

      class DimensionMismatchAdapter extends MockEmbeddingAdapter {
        async embedBatch() {
          callCount++;
          throw new EmbeddingDimensionMismatchError(768, 512);
        }
      }

      const manager = new BatchEmbeddingManager({
        adapter: new DimensionMismatchAdapter(),
        maxRetries: 3,
        enableCache: false
      });

      await assert.rejects(
        async () => await manager.embedTexts(['Altimeter check']),
        (err) => err instanceof EmbeddingDimensionMismatchError
      );

      assert.equal(callCount, 1);
    });
  });

  await t.test('Partial Batch Failure Isolation', async (t2) => {
    await t2.test('should isolate a poison pill item in sub-batch mode and preserve valid items', async () => {
      class PoisonPillAdapter extends MockEmbeddingAdapter {
        async embedBatch(texts, options = {}) {
          // If the batch contains "POISON", fail the entire batch
          if (texts.some(t => t.includes('POISON'))) {
            throw new EmbeddingInvalidResponseError('Corrupted byte payload in text');
          }
          return super.embedBatch(texts, options);
        }
      }

      const manager = new BatchEmbeddingManager({
        adapter: new PoisonPillAdapter(),
        batchSize: 3,
        partialFailureMode: 'isolate_subbatch',
        enableCache: false
      });

      const inputs = [
        'Valid procedure step 1',
        'POISON - Invalid corrupt data',
        'Valid procedure step 3'
      ];

      const res = await manager.embedTexts(inputs);

      assert.equal(res.summary.totalTexts, 3);
      assert.equal(res.summary.successCount, 2); // 2 good items salvaged!
      assert.equal(res.summary.failureCount, 1);
      assert.equal(res.failures[0].index, 1);
      assert.ok(res.failures[0].error.includes('Corrupted byte payload'));
      assert.ok(res.embeddings[0].vector);
      assert.ok(res.embeddings[2].vector);
    });
  });

  await t.test('Idempotency & Duplicate Work Prevention via Stable Hash', async (t2) => {
    await t2.test('should reuse cached embeddings on repeated ingestion and avoid redundant provider calls', async () => {
      let providerCalls = 0;

      class CountingAdapter extends MockEmbeddingAdapter {
        async embedBatch(texts, options = {}) {
          providerCalls += texts.length;
          return super.embedBatch(texts, options);
        }
      }

      const manager = new BatchEmbeddingManager({
        adapter: new CountingAdapter(),
        batchSize: 5,
        enableCache: true
      });

      const procedures = [
        'Checklist step A: Set flaps',
        'Checklist step B: Check gear down',
        'Checklist step C: Green light verified'
      ];

      // Run 1: Cold ingestion
      const run1 = await manager.embedTexts(procedures);
      assert.equal(run1.summary.cacheHits, 0);
      assert.equal(run1.summary.cacheMisses, 3);
      assert.equal(providerCalls, 3);
      assert.equal(manager.getCacheSize(), 3);

      // Run 2: Repeated ingestion on exact same inputs
      const run2 = await manager.embedTexts(procedures);
      assert.equal(run2.summary.cacheHits, 3);
      assert.equal(run2.summary.cacheMisses, 0);
      // Provider call count must NOT increase!
      assert.equal(providerCalls, 3);
      for (const emb of run2.embeddings) {
        assert.equal(emb.isFromCache, true);
      }
    });

    await t2.test('should produce distinct cache keys when embedding model differs', () => {
      const text = 'Emergency descent step 1';
      const keyModelA = computeEmbeddingCacheKey(text, 'text-embedding-004', 768);
      const keyModelB = computeEmbeddingCacheKey(text, 'gemini-embedding-001', 3072);

      assert.notEqual(keyModelA, keyModelB, 'Cache keys must differ across different models/dimensions');
    });
  });

  await t.test('Usage Accounting & Cost Estimation', async (t2) => {
    await t2.test('should mark usage as estimated when provider does not supply token counts', async () => {
      const manager = new BatchEmbeddingManager({
        adapter: new MockEmbeddingAdapter(),
        enableCache: false
      });

      const res = await manager.embedTexts(['Flight crew sterile cockpit rules below 10000 feet']);

      assert.ok(res.usage.totalTokens > 0);
      assert.equal(res.usage.isEstimated, true);
    });

    await t2.test('should calculate cost accurately when pricing is configured', async () => {
      const manager = new BatchEmbeddingManager({
        adapter: new MockEmbeddingAdapter(),
        pricing: { inputCostPerM: 0.025 }, // $0.025 per 1M tokens
        enableCache: false
      });

      const res = await manager.embedTexts(['Standard operating procedure flight manual']);

      assert.equal(res.usage.pricingAvailable, true);
      assert.ok(typeof res.usage.costUsd === 'number');
      assert.ok(res.usage.costUsd >= 0);
    });

    await t2.test('should report pricingAvailable: false and costUsd: null when pricing is unconfigured', async () => {
      const manager = new BatchEmbeddingManager({
        adapter: new MockEmbeddingAdapter(),
        pricing: null,
        enableCache: false
      });

      const res = await manager.embedTexts(['Short query']);

      assert.equal(res.usage.pricingAvailable, false);
      assert.equal(res.usage.costUsd, null);
    });
  });

});
