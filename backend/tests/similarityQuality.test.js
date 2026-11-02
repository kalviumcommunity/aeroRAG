/**
 * ============================================================================
 * Unit Tests for Milestone 3.27 & 3.29: Similarity Metrics & Quality Checks
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCosineSimilarity,
  computeEuclideanDistance,
  computeDotProduct,
  rankBySimilarity,
  inspectVector,
  validateVector,
  SIMILARITY_SAFETY_DISCLAIMER,
  InvalidVectorError,
  VectorDimensionMismatchError,
  ZeroVectorError,
  IncompatibleVectorSpaceError
} from '../src/rag/similarityValidator.js';

import {
  evaluateSimilarityQuality,
  loadSimilarityEvaluationSet,
  formatEvaluationReportMarkdown
} from '../src/rag/similarityQualityEvaluator.js';

import { MockEmbeddingAdapter } from '../src/rag/embeddingAdapter.js';

describe('Milestones 3.27 & 3.29: Similarity Metrics, Vector Checks & Deterministic Ranking', () => {

  // ==========================================================================
  // 1. Vector Inspection & Numerical Input Validation
  // ==========================================================================
  describe('Vector Inspection & Input Validation', () => {
    test('should validate normal finite float vectors successfully', () => {
      const vec = [0.1, 0.2, 0.3, 0.4];
      const result = inspectVector(vec);
      assert.equal(result.isValid, true);
      assert.equal(result.dimensions, 4);
      assert.equal(result.hasNonFinite, false);
      assert.equal(result.isZeroVector, false);
    });

    test('should reject null, undefined, and non-array vectors', () => {
      assert.throws(() => validateVector(null), InvalidVectorError);
      assert.throws(() => validateVector(undefined), InvalidVectorError);
      assert.throws(() => validateVector('not a vector'), InvalidVectorError);
      assert.throws(() => validateVector({ length: 4 }), InvalidVectorError);
    });

    test('should reject empty vectors with length 0', () => {
      assert.throws(() => validateVector([]), InvalidVectorError);
      const inspection = inspectVector([]);
      assert.equal(inspection.isValid, false);
      assert.match(inspection.errors[0], /empty/i);
    });

    test('should detect and reject NaN values in vector', () => {
      const vec = [0.1, NaN, 0.3];
      assert.throws(() => validateVector(vec), InvalidVectorError);
      const inspection = inspectVector(vec);
      assert.equal(inspection.hasNonFinite, true);
      assert.equal(inspection.invalidIndex, 1);
    });

    test('should detect and reject Infinity and -Infinity in vector', () => {
      assert.throws(() => validateVector([0.1, Infinity, 0.3]), InvalidVectorError);
      assert.throws(() => validateVector([0.1, -Infinity, 0.3]), InvalidVectorError);
    });

    test('should detect and reject non-numeric string items inside vector', () => {
      assert.throws(() => validateVector([0.1, "0.2", 0.3]), InvalidVectorError);
    });

    test('should enforce expected dimensions when configured', () => {
      const vec = [0.1, 0.2, 0.3];
      assert.throws(() => validateVector(vec, { expectedDimensions: 768 }), VectorDimensionMismatchError);
    });

    test('should correctly identify unit-normalized vectors vs unnormalized vectors', () => {
      // Unit vector along x-axis
      const unit = [1.0, 0.0, 0.0];
      const unnorm = [2.0, 2.0, 2.0];
      assert.equal(inspectVector(unit).isNormalized, true);
      assert.equal(inspectVector(unnorm).isNormalized, false);
    });
  });

  // ==========================================================================
  // 2. Zero Vector Handling
  // ==========================================================================
  describe('Zero Vector Handling', () => {
    test('should identify all-zero vectors in inspection', () => {
      const zeroVec = [0.0, 0.0, 0.0, 0.0];
      const inspection = inspectVector(zeroVec);
      assert.equal(inspection.isZeroVector, true);
      assert.equal(inspection.norm, 0.0);
    });

    test('should safely return 0.0 similarity when allowZeroVector is true (default)', () => {
      const zeroVec = [0.0, 0.0, 0.0];
      const normalVec = [1.0, 2.0, 3.0];
      const sim1 = computeCosineSimilarity(zeroVec, normalVec, { allowZeroVector: true });
      const sim2 = computeCosineSimilarity(normalVec, zeroVec, { allowZeroVector: true });
      const sim3 = computeCosineSimilarity(zeroVec, zeroVec, { allowZeroVector: true });
      assert.equal(sim1, 0.0);
      assert.equal(sim2, 0.0);
      assert.equal(sim3, 0.0);
    });

    test('should throw ZeroVectorError when allowZeroVector is false', () => {
      const zeroVec = [0.0, 0.0, 0.0];
      const normalVec = [1.0, 2.0, 3.0];
      assert.throws(() => {
        computeCosineSimilarity(zeroVec, normalVec, { allowZeroVector: false });
      }, ZeroVectorError);

      assert.throws(() => {
        validateVector(zeroVec, { allowZeroVector: false });
      }, ZeroVectorError);
    });
  });

  // ==========================================================================
  // 3. Mathematical Properties of Cosine Similarity
  // ==========================================================================
  describe('Mathematical Properties of Cosine Similarity', () => {
    test('should return exactly 1.0 for identical vectors', () => {
      const vecA = [0.6, 0.8];
      const sim = computeCosineSimilarity(vecA, vecA);
      assert.equal(sim, 1.0);
    });

    test('should return exactly -1.0 for diametrically opposite vectors', () => {
      const vecA = [0.6, 0.8];
      const vecB = [-0.6, -0.8];
      const sim = computeCosineSimilarity(vecA, vecB);
      assert.equal(sim, -1.0);
    });

    test('should return exactly 0.0 for orthogonal vectors', () => {
      const vecA = [1.0, 0.0];
      const vecB = [0.0, 1.0];
      const sim = computeCosineSimilarity(vecA, vecB);
      assert.equal(sim, 0.0);
    });

    test('should clamp floating-point results to [-1.0, 1.0] range', () => {
      const vecA = [1.000000001, 0.0];
      const vecB = [1.0, 0.0];
      const sim = computeCosineSimilarity(vecA, vecB);
      assert.ok(sim >= -1.0 && sim <= 1.0);
    });

    test('should calculate Euclidean distance and Dot product correctly', () => {
      const vecA = [3.0, 0.0];
      const vecB = [0.0, 4.0];
      const dist = computeEuclideanDistance(vecA, vecB);
      assert.equal(dist, 5.0); // 3-4-5 right triangle

      const dot = computeDotProduct(vecA, vecB);
      assert.equal(dot, 0.0); // Orthogonal
    });
  });

  // ==========================================================================
  // 4. SAFETY INVARIANT: Vector Space Compatibility & Model Mismatches
  // ==========================================================================
  describe('SAFETY INVARIANT: Model & Vector Space Mismatches', () => {
    test('should throw VectorDimensionMismatchError when vector lengths differ', () => {
      const vecA = [1.0, 2.0, 3.0];
      const vecB = [1.0, 2.0];
      assert.throws(() => computeCosineSimilarity(vecA, vecB), VectorDimensionMismatchError);
    });

    test('should throw IncompatibleVectorSpaceError when embedding models differ', () => {
      const vecA = [0.5, 0.5];
      const vecB = [0.5, 0.5];
      const metaA = { model: 'text-embedding-004', dimensions: 2 };
      const metaB = { model: 'gemini-embedding-001', dimensions: 2 };

      assert.throws(() => {
        computeCosineSimilarity(vecA, vecB, { metaA, metaB, strictModelCheck: true });
      }, IncompatibleVectorSpaceError);
    });

    test('should succeed when models and dimensions match', () => {
      const vecA = [0.5, 0.5];
      const vecB = [0.5, 0.5];
      const meta = { model: 'mock-text-embedding-004', dimensions: 2 };

      const sim = computeCosineSimilarity(vecA, vecB, { metaA: meta, metaB: meta });
      assert.equal(sim, 1.0);
    });
  });

  // ==========================================================================
  // 5. Deterministic Candidate Ranking
  // ==========================================================================
  describe('Deterministic Candidate Ranking Engine', () => {
    test('should sort candidates in descending order of similarity score', () => {
      const query = [1.0, 0.0];
      const candidates = [
        { id: 'low', vector: [0.0, 1.0] },      // sim = 0.0
        { id: 'high', vector: [1.0, 0.0] },     // sim = 1.0
        { id: 'mid', vector: [0.7071, 0.7071] } // sim = 0.707
      ];

      const ranked = rankBySimilarity(query, candidates);
      assert.equal(ranked.results[0].id, 'high');
      assert.equal(ranked.results[1].id, 'mid');
      assert.equal(ranked.results[2].id, 'low');
      assert.equal(ranked.results[0].rank, 1);
      assert.equal(ranked.results[1].rank, 2);
      assert.equal(ranked.results[2].rank, 3);
    });

    test('should deterministically break ties using candidate ID', () => {
      const query = [1.0, 0.0];
      // All three have identical similarity = 1.0
      const candidates = [
        { id: 'doc-gamma', vector: [1.0, 0.0] },
        { id: 'doc-alpha', vector: [1.0, 0.0] },
        { id: 'doc-beta', vector: [1.0, 0.0] }
      ];

      const ranked = rankBySimilarity(query, candidates, { tieBreakerField: 'id' });
      assert.equal(ranked.results[0].id, 'doc-alpha');
      assert.equal(ranked.results[1].id, 'doc-beta');
      assert.equal(ranked.results[2].id, 'doc-gamma');
    });

    test('should support topK truncation and minSimilarityThreshold filtering', () => {
      const query = [1.0, 0.0];
      const candidates = [
        { id: 'c1', vector: [1.0, 0.0] },  // sim = 1.0
        { id: 'c2', vector: [0.8, 0.6] },  // sim = 0.8
        { id: 'c3', vector: [0.0, 1.0] },  // sim = 0.0
        { id: 'c4', vector: [-1.0, 0.0] }  // sim = -1.0
      ];

      // minSimilarityThreshold = 0.5 should keep c1 and c2 only
      const filtered = rankBySimilarity(query, candidates, { minSimilarityThreshold: 0.5 });
      assert.equal(filtered.results.length, 2);

      // topK = 1 should return only c1
      const top1 = rankBySimilarity(query, candidates, { topK: 1 });
      assert.equal(top1.results.length, 1);
      assert.equal(top1.results[0].id, 'c1');
    });

    test('SAFETY INVARIANT: All ranking outputs must include the safety disclaimer', () => {
      const query = [1.0, 0.0];
      const candidates = [{ id: 'chk-1', vector: [1.0, 0.0] }];
      const ranked = rankBySimilarity(query, candidates);

      assert.equal(typeof ranked.safetyDisclaimer, 'string');
      assert.match(ranked.safetyDisclaimer, /does not establish operational validity/i);
      assert.equal(ranked.safetyDisclaimer, SIMILARITY_SAFETY_DISCLAIMER);
    });
  });

  // ==========================================================================
  // 6. Synthetic Procedural Evaluation Benchmark & Quality Checks
  // ==========================================================================
  describe('Synthetic Procedural Quality Checks & Evaluation Set', () => {
    test('should load the synthetic procedural evaluation dataset cleanly', () => {
      const dataset = loadSimilarityEvaluationSet();
      assert.ok(Array.isArray(dataset.corpus));
      assert.ok(Array.isArray(dataset.queries));
      assert.ok(dataset.corpus.length >= 10);
      assert.ok(dataset.queries.length >= 5);
    });

    test('should evaluate related procedural queries against unrelated topics with positive separation', async () => {
      const report = await evaluateSimilarityQuality({ minSeparationMargin: 0.20 });

      assert.equal(report.metrics.queriesEvaluated, 5);
      assert.ok(report.metrics.top1Accuracy >= 0.80);
      assert.ok(report.metrics.meanRelatedSimilarity > report.metrics.meanUnrelatedSimilarity);
      assert.ok(report.metrics.separationMargin >= 0.20);
      assert.equal(report.vectorAudit.validVectors, report.vectorAudit.totalVectors);
      assert.equal(report.vectorAudit.hasNonFinite, false);
    });

    test('SAFETY INVARIANT: should detect and report superseded procedure ranked first as safety warning', async () => {
      const report = await evaluateSimilarityQuality();
      const supersededAnomaly = report.anomalies.find(a => a.type === 'SUPERSEDED_PROCEDURE_RANKED_FIRST');

      assert.ok(supersededAnomaly, 'Must detect and flag superseded procedure when it scores highest due to lexical similarity');
      assert.equal(supersededAnomaly.severity, 'SAFETY_WARNING');
      assert.match(supersededAnomaly.description, /high similarity does not certify current operational validity/i);
    });

    test('should detect and report simulated unexpected ranking inversions', async () => {
      const report = await evaluateSimilarityQuality({ injectAnomaly: true });
      const inversion = report.anomalies.find(a => a.type === 'UNEXPECTED_RANKING_INVERSION');

      assert.ok(inversion, 'Must detect unexpected ranking inversion anomaly');
      assert.equal(inversion.severity, 'HIGH');
      assert.equal(report.overallStatus, 'INVESTIGATION_REQUIRED');
    });

    test('should format evaluation report cleanly into GitHub-flavored Markdown', async () => {
      const report = await evaluateSimilarityQuality();
      const markdown = formatEvaluationReportMarkdown(report);

      assert.match(markdown, /# Similarity Metrics & Embedding Quality Evaluation Report/);
      assert.match(markdown, /Executive Summary/);
      assert.match(markdown, /Vector Numerical Integrity Audit/);
      assert.match(markdown, /Safety Invariant/);
    });
  });

});
