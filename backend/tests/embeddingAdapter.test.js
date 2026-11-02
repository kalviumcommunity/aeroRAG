/**
 * ============================================================================
 * Milestone 3.25 & 3.26: Embedding Adapter & Vector Space Validation Tests
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createEmbeddingAdapter,
  MockEmbeddingAdapter,
  GeminiEmbeddingAdapter,
  validateEmbeddingVector,
  normalizeVector,
  isCompatibleVectorSpace,
  cosineSimilarity,
  EmbeddingError,
  MissingEmbeddingConfigurationError,
  EmbeddingTimeoutError,
  EmbeddingRateLimitError,
  EmbeddingDimensionMismatchError,
  EmbeddingInvalidResponseError,
  IncompatibleVectorSpaceError
} from '../src/rag/embeddingAdapter.js';

import { generateEmbedding, generateEmbeddingRecord } from '../src/rag/embedder.js';

test('Milestone 3.25 & 3.26: Embedding Service & Vector Space Validation', async (t) => {

  await t.test('Vector Validation & Numeric Finiteness', async (t2) => {
    await t2.test('should validate valid normalized float vectors successfully', () => {
      const vec = [0.6, 0.8]; // L2 norm = 1.0
      assert.doesNotThrow(() => validateEmbeddingVector(vec, 2));
    });

    await t2.test('should throw EmbeddingDimensionMismatchError when vector dimension does not match', () => {
      const vec = [0.1, 0.2, 0.3];
      assert.throws(
        () => validateEmbeddingVector(vec, 768),
        (err) => err instanceof EmbeddingDimensionMismatchError && err.expected === 768 && err.actual === 3
      );
    });

    await t2.test('should throw EmbeddingInvalidResponseError on non-finite, NaN, or Infinity vector values', () => {
      const nanVec = [0.1, NaN, 0.3];
      assert.throws(
        () => validateEmbeddingVector(nanVec, 3),
        (err) => err instanceof EmbeddingInvalidResponseError && err.message.includes('NaN')
      );

      const infVec = [0.1, Infinity, 0.3];
      assert.throws(
        () => validateEmbeddingVector(infVec, 3),
        (err) => err instanceof EmbeddingInvalidResponseError && err.message.includes('Infinity')
      );
    });

    await t2.test('should normalize vectors to unit length (L2 norm = 1.0)', () => {
      const raw = [3.0, 4.0];
      const norm = normalizeVector(raw);
      assert.equal(norm.length, 2);
      assert.equal(norm[0], 0.6);
      assert.equal(norm[1], 0.8);

      const l2 = Math.sqrt(norm[0] * norm[0] + norm[1] * norm[1]);
      assert.ok(Math.abs(l2 - 1.0) < 1e-6);
    });
  });

  await t.test('Mock Embedding Adapter (Offline Execution)', async (t2) => {
    await t2.test('should generate normalized 768-dimensional embeddings by default', async () => {
      const adapter = new MockEmbeddingAdapter();
      const res = await adapter.embedQuery('Sterile cockpit below 10,000 feet');

      assert.equal(res.dimensions, 768);
      assert.equal(res.vector.length, 768);
      assert.equal(res.model, 'mock-text-embedding-004');
      assert.equal(res.provider, 'mock');
      assert.ok(res.generatedAt);

      // Verify unit length
      const l2 = Math.sqrt(res.vector.reduce((sum, v) => sum + v * v, 0));
      assert.ok(Math.abs(l2 - 1.0) < 1e-5, `L2 norm (${l2}) must be 1.0`);
    });

    await t2.test('should support configurable dimensions (e.g. 512, 1536)', async () => {
      const adapter512 = new MockEmbeddingAdapter({ dimensions: 512 });
      const res512 = await adapter512.embedQuery('Engine failure in flight');
      assert.equal(res512.dimensions, 512);
      assert.equal(res512.vector.length, 512);

      const adapter1536 = new MockEmbeddingAdapter({ dimensions: 1536 });
      const res1536 = await adapter1536.embedQuery('Emergency descent');
      assert.equal(res1536.dimensions, 1536);
      assert.equal(res1536.vector.length, 1536);
    });

    await t2.test('should reject empty or whitespace query strings', async () => {
      const adapter = new MockEmbeddingAdapter();
      await assert.rejects(
        async () => await adapter.embedQuery('   '),
        (err) => err instanceof EmbeddingInvalidResponseError
      );
    });
  });

  await t.test('Batch Embedding & Chunk Decoration', async (t2) => {
    await t2.test('should embed a batch of texts preserving ordering and response count', async () => {
      const adapter = new MockEmbeddingAdapter({ batchSize: 2 });
      const texts = [
        'Checklist 1: Pre-flight briefing',
        'Checklist 2: Pushback and engine start',
        'Checklist 3: Taxi and runway crossing',
        'Checklist 4: Before takeoff clearance',
        'Checklist 5: Climb passing 10,000 feet'
      ];

      const results = await adapter.embedBatch(texts);

      assert.equal(results.length, 5);
      for (let i = 0; i < results.length; i++) {
        assert.equal(results[i].dimensions, 768);
        assert.equal(results[i].vector.length, 768);
      }
    });

    await t2.test('should decorate chunks with embeddings and model identity metadata', async () => {
      const adapter = new MockEmbeddingAdapter({ model: 'text-embedding-004-v1' });
      const mockChunks = [
        {
          id: 'SOP_737_chunk_0',
          text: 'Sterile cockpit procedures apply below 10,000 feet MSL.',
          metadata: { page: 12, documentId: 'SOP-737' }
        },
        {
          id: 'SOP_737_chunk_1',
          text: 'Both pilots must crosscheck altimeters prior to departure.',
          metadata: { page: 13, documentId: 'SOP-737' }
        }
      ];

      const enriched = await adapter.embedChunks(mockChunks);

      assert.equal(enriched.length, 2);
      assert.equal(enriched[0].embedding.length, 768);
      assert.equal(enriched[0].metadata.embeddingModel, 'text-embedding-004-v1');
      assert.equal(enriched[0].metadata.embeddingDimensions, 768);
      assert.equal(enriched[0].metadata.embeddingProvider, 'mock');
      assert.ok(enriched[0].metadata.embeddingGeneratedAt);
      assert.equal(enriched[0].metadata.page, 12);
    });
  });

  await t.test('Safety Invariant: Vector Space Compatibility Enforcement', async (t2) => {
    await t2.test('should calculate cosine similarity when vector spaces match', () => {
      const meta = { model: 'text-embedding-004', dimensions: 4 };
      const vecA = [1, 0, 0, 0];
      const vecB = [0.7071, 0.7071, 0, 0];

      const sim = cosineSimilarity(vecA, vecB, meta, meta);
      assert.ok(Math.abs(sim - 0.7071) < 1e-4);
    });

    await t2.test('CRITICAL INVARIANT: should throw IncompatibleVectorSpaceError when models differ', () => {
      const metaA = { model: 'text-embedding-004', dimensions: 768 };
      const metaB = { model: 'text-embedding-3-small', dimensions: 768 }; // Same dim, different model!
      const vecA = new Array(768).fill(0.1);
      const vecB = new Array(768).fill(0.1);

      assert.throws(
        () => cosineSimilarity(vecA, vecB, metaA, metaB),
        (err) => err instanceof IncompatibleVectorSpaceError && err.modelA === 'text-embedding-004' && err.modelB === 'text-embedding-3-small'
      );
    });

    await t2.test('CRITICAL INVARIANT: should throw IncompatibleVectorSpaceError when dimensions differ', () => {
      const metaA = { model: 'text-embedding-004', dimensions: 768 };
      const metaB = { model: 'text-embedding-004', dimensions: 1536 };
      const vecA = new Array(768).fill(0.1);
      const vecB = new Array(1536).fill(0.1);

      assert.throws(
        () => cosineSimilarity(vecA, vecB, metaA, metaB),
        (err) => err instanceof IncompatibleVectorSpaceError
      );
    });
  });

  await t.test('Synthetic Semantic Similarity Demonstration', async (t2) => {
    await t2.test('should demonstrate that semantically related procedural texts produce higher similarity than unrelated texts', async () => {
      const adapter = new MockEmbeddingAdapter();

      // Procedural Query
      const query = 'How do flight crews initiate an emergency descent procedure?';

      // Semantically Related Passage (Emergency descent checklist)
      const relatedPassage = `
        EMERGENCY DESCENT CHECKLIST
        1. Announce emergency descent on PA and flight interphone.
        2. Set passenger signs to ON.
        3. Disconnect autothrottle and retard thrust levers to flight idle.
        4. Extend speedbrakes smoothly to full flight position.
        5. Set target altitude to lowest safe altitude or 10,000 feet.
      `;

      // Unrelated Passage (Passenger baggage policy)
      const unrelatedPassage = `
        BAGGAGE ALLOWANCE AND FARE RULES
        Economy passengers are permitted one standard carry-on bag and one personal item.
        Maximum baggage dimensions must not exceed 22 x 14 x 9 inches.
        Excess baggage fees apply for sporting equipment and overweight baggage at gate check-in.
      `;

      const qEmb = await adapter.embedQuery(query);
      const relEmb = await adapter.embedQuery(relatedPassage);
      const unrelEmb = await adapter.embedQuery(unrelatedPassage);

      const relSim = cosineSimilarity(qEmb.vector, relEmb.vector, qEmb, relEmb);
      const unrelSim = cosineSimilarity(qEmb.vector, unrelEmb.vector, qEmb, unrelEmb);

      // Verify that the related procedure has substantially higher cosine similarity than unrelated baggage text
      assert.ok(
        relSim > unrelSim,
        `Related procedure similarity (${relSim}) must be higher than unrelated baggage text (${unrelSim})`
      );
      assert.ok(
        relSim >= 0.30,
        `Related procedure similarity (${relSim}) should be meaningful (>= 0.30)`
      );
      assert.ok(
        unrelSim < 0.10,
        `Unrelated baggage similarity (${unrelSim}) should be low (< 0.10)`
      );
      assert.ok(
        relSim - unrelSim > 0.20,
        `Semantic separation margin (${relSim - unrelSim}) should be at least 0.20`
      );
    });
  });

  await t.test('Error Handling & Factory Integration', async (t2) => {
    await t2.test('should throw MissingEmbeddingConfigurationError when Gemini provider lacks credentials', () => {
      assert.throws(
        () => new GeminiEmbeddingAdapter({ apiKey: null }),
        (err) => err instanceof MissingEmbeddingConfigurationError
      );
    });

    await t2.test('should handle simulated timeouts and rate limits cleanly', async () => {
      const timeoutAdapter = new MockEmbeddingAdapter({
        simulatedError: new EmbeddingTimeoutError('Simulated timeout', { timeoutMs: 5000 })
      });
      await assert.rejects(
        async () => await timeoutAdapter.embedQuery('Test'),
        (err) => err instanceof EmbeddingTimeoutError && err.statusCode === 504
      );

      const rateLimitAdapter = new MockEmbeddingAdapter({
        simulatedError: new EmbeddingRateLimitError('Simulated quota exceeded', { retryAfterMs: 3000 })
      });
      await assert.rejects(
        async () => await rateLimitAdapter.embedQuery('Test'),
        (err) => err instanceof EmbeddingRateLimitError && err.statusCode === 429 && err.retryAfterMs === 3000
      );
    });

    await t2.test('createEmbeddingAdapter factory creates mock adapter in test/demo mode', () => {
      const adapter = createEmbeddingAdapter({ mock: true });
      assert.ok(adapter instanceof MockEmbeddingAdapter);
      assert.equal(adapter.providerName, 'mock');
    });

    await t2.test('embedder.js facade provides backward-compatible generateEmbedding', async () => {
      const adapter = new MockEmbeddingAdapter();
      const vec = await generateEmbedding('Autopilot disengage standard', { adapter });

      assert.ok(Array.isArray(vec));
      assert.equal(vec.length, 768);

      const rec = await generateEmbeddingRecord('Autopilot disengage standard', { adapter });
      assert.equal(rec.dimensions, 768);
      assert.ok(rec.generatedAt);
    });
  });

});
