/**
 * ============================================================================
 * Milestone 3.31 Test Suite: Indexing Embeddings & Metadata Storage
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  VectorIndexingService,
  QdrantVectorCollection,
  validateVectorDimensions,
  validateMetadataCompleteness,
  validatePointCounts,
  IndexingIntegrityError,
  VectorDimensionMismatchError,
  MetadataCompletenessError,
  PointCountIntegrityError,
  FailedIndexingError
} from '../src/rag/vectorIndexingService.js';
import {
  generatePointId,
  isValidPointId,
  InMemoryQdrantClient
} from '../src/rag/qdrantClient.js';
import { CanonicalMetadataRegistry } from '../src/rag/canonicalRegistry.js';
import { MockEmbeddingAdapter } from '../src/rag/embeddingAdapter.js';
import { createBatchEmbeddingManager } from '../src/rag/batchEmbeddingManager.js';
import {
  DOC_SOP_787_ICE,
  DOC_QRH_320_SMOKE,
  DOC_SB_WINTER_OPS,
  DOC_SOP_787_ICE_REV2,
  ALL_SYNTHETIC_DOCS
} from './fixtures/syntheticAirlineDocs.js';

describe('Milestone 3.31: Vector Indexing & Metadata Storage (Qdrant)', () => {
  let qdrantClient;
  let registry;
  let indexingService;
  let mockAdapter;
  let batchManager;

  beforeEach(async () => {
    qdrantClient = new InMemoryQdrantClient();
    registry = new CanonicalMetadataRegistry({ autoLoad: false });
    mockAdapter = new MockEmbeddingAdapter({ dimension: 768 });
    batchManager = createBatchEmbeddingManager({ adapter: mockAdapter });

    indexingService = new VectorIndexingService({
      qdrantClient,
      canonicalRegistry: registry,
      batchManager,
      dimension: 768,
      collectionName: 'aerorag_chunks_test'
    });
    await indexingService.init();
  });

  describe('Task 1: Stable Point Identifiers (RFC 4122 Compliant)', () => {
    it('should generate valid RFC 4122 UUID strings for point IDs', () => {
      const pid = generatePointId('SOP-OPS-737-04', 0);
      assert.strictEqual(typeof pid, 'string');
      assert.strictEqual(isValidPointId(pid), true);

      // Verify UUID version 5 format regex
      const uuidV5Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert.match(pid, uuidV5Regex);
    });

    it('should generate deterministic point IDs across multiple invocations', () => {
      const id1 = generatePointId('SOP-AIR-787-ICE', 2);
      const id2 = generatePointId('SOP-AIR-787-ICE', 2);
      const id3 = generatePointId('SOP-AIR-787-ICE', 2);
      assert.strictEqual(id1, id2);
      assert.strictEqual(id2, id3);
    });

    it('should generate distinct point IDs for different chunk indices and documents', () => {
      const docA0 = generatePointId('DOC-A', 0);
      const docA1 = generatePointId('DOC-A', 1);
      const docB0 = generatePointId('DOC-B', 0);

      assert.notStrictEqual(docA0, docA1);
      assert.notStrictEqual(docA0, docB0);
    });

    it('should throw error when generating point ID with invalid or missing documentId', () => {
      assert.throws(() => generatePointId('', 0), /requires a valid documentId/);
      assert.throws(() => generatePointId(null, 0), /requires a valid documentId/);
    });
  });

  describe('Task 2: End-to-End Synthetic Document Ingestion & Indexing', () => {
    it('should ingest and index a synthetic procedure document end-to-end', async () => {
      const report = await indexingService.indexDocument(DOC_SOP_787_ICE);

      assert.strictEqual(report.status, 'INDEXED');
      assert.strictEqual(report.documentId, 'SOP-AIR-787-ICE');
      assert.ok(report.pointsIndexed > 0);
      assert.strictEqual(report.vectorDimension, 768);
      assert.strictEqual(report.integrityChecks.readbackVerified, true);

      // Verify point count in vector collection
      const collectionPoints = await indexingService.collection.count();
      assert.strictEqual(collectionPoints, report.pointsIndexed);

      // Read back first point and inspect payload
      const firstPt = await indexingService.collection.get(report.pointIds[0]);
      assert.ok(firstPt);
      assert.strictEqual(firstPt.vector.length, 768);
      assert.strictEqual(firstPt.metadata.document_id, 'SOP-AIR-787-ICE');
      assert.strictEqual(firstPt.metadata.version, '3.1');
      assert.ok(firstPt.metadata.text.length > 0);
    });

    it('should ingest an entire corpus of diverse synthetic airline documents', async () => {
      const corpusReport = await indexingService.indexCorpus(ALL_SYNTHETIC_DOCS);

      assert.strictEqual(corpusReport.status, 'COMPLETED');
      assert.strictEqual(corpusReport.totalDocumentsProcessed, 3);
      assert.strictEqual(corpusReport.totalFailures, 0);
      assert.ok(corpusReport.totalPointsIndexed > 0);
      assert.strictEqual(corpusReport.totalCollectionPoints, corpusReport.totalPointsIndexed);

      // Verify each document is present in the canonical registry
      for (const doc of ALL_SYNTHETIC_DOCS) {
        assert.strictEqual(registry.hasDocument(doc.documentId), true);
      }
    });
  });

  describe('Task 3: Safe Upsert & Idempotent Re-Ingestion (No Uncontrolled Duplicates)', () => {
    it('should skip duplicate embedding and preserve collection point count on repeated identical ingestion', async () => {
      // First ingestion
      const initialReport = await indexingService.indexDocument(DOC_QRH_320_SMOKE);
      const pointsAfterFirst = await indexingService.collection.count();
      assert.ok(pointsAfterFirst > 0);

      // Second ingestion (identical content)
      const secondReport = await indexingService.indexDocument(DOC_QRH_320_SMOKE);
      assert.strictEqual(secondReport.status, 'IDEMPOTENT_SKIPPED');
      assert.strictEqual(secondReport.pointsIndexed, 0);

      // Collection points count must remain strictly unchanged
      const pointsAfterSecond = await indexingService.collection.count();
      assert.strictEqual(pointsAfterSecond, pointsAfterFirst);

      // Third ingestion (forced re-indexing)
      const thirdReport = await indexingService.indexDocument(DOC_QRH_320_SMOKE, { forceReindex: true });
      assert.strictEqual(thirdReport.status, 'INDEXED');

      // Points are upserted in-place via stable point IDs without duplicating points
      const pointsAfterThird = await indexingService.collection.count();
      assert.strictEqual(pointsAfterThird, pointsAfterFirst);
    });

    it('should safely replace points and prune orphaned vectors when a document is updated with fewer chunks', async () => {
      // Ingest original document (longer)
      const rep1 = await indexingService.indexDocument(DOC_SOP_787_ICE);
      const initialPoints = rep1.pointsIndexed;
      assert.ok(initialPoints > 0);

      // Ingest revised document (shorter revision)
      const rep2 = await indexingService.indexDocument(DOC_SOP_787_ICE_REV2);
      assert.strictEqual(rep2.status, 'INDEXED');

      // Collection count must strictly equal the updated revision chunk count
      const currentCollectionCount = await indexingService.collection.count();
      assert.strictEqual(currentCollectionCount, rep2.pointsIndexed);

      // Canonical registry reflects new version
      const canonical = registry.getDocument('SOP-AIR-787-ICE');
      assert.strictEqual(canonical.version, '4.0');
      assert.strictEqual(canonical.chunkCount, rep2.pointsIndexed);
    });
  });

  describe('Task 4: Canonical Document Metadata Linkage & Bi-Directional Resolution', () => {
    it('should preserve bi-directional links between indexed points and canonical metadata records', async () => {
      const report = await indexingService.indexDocument(DOC_SB_WINTER_OPS);
      const pointId = report.pointIds[0];

      // Resolve point back to document
      const resolution = registry.resolvePointToDocument(pointId);
      assert.ok(resolution);
      assert.strictEqual(resolution.documentId, 'SB-OPS-2024-11');
      assert.strictEqual(resolution.chunkIndex, 0);
      assert.strictEqual(resolution.document.title, DOC_SB_WINTER_OPS.title);
      assert.strictEqual(resolution.document.status, 'APPLICABLE');

      // Lookup points by document ID
      const retrievedPointIds = registry.getPointIdsForDocument('SB-OPS-2024-11');
      assert.deepStrictEqual(retrievedPointIds, report.pointIds);
    });

    it('should include standardized citations in chunk payloads', async () => {
      const report = await indexingService.indexDocument(DOC_SOP_787_ICE);
      const point = await indexingService.collection.get(report.pointIds[0]);
      assert.ok(point.metadata.citation);
      assert.ok(point.metadata.citation.includes('SOP-AIR-787-ICE'));
      assert.ok(point.metadata.citation.includes('APPLICABLE'));
    });
  });

  describe('Task 5: Integrity Checks & Failure Handling', () => {
    it('should validate vector dimensions and reject vectors with dimension mismatches', () => {
      // Valid vectors
      const validVectors = [
        new Array(768).fill(0.1),
        new Array(768).fill(0.2)
      ];
      const validReport = validateVectorDimensions(validVectors, 768);
      assert.strictEqual(validReport.valid, true);

      // Dimension mismatch
      const invalidVectors = [
        new Array(768).fill(0.1),
        new Array(512).fill(0.2) // Mismatched dimension
      ];
      assert.throws(
        () => validateVectorDimensions(invalidVectors, 768),
        VectorDimensionMismatchError
      );
    });

    it('should reject vectors containing NaN, Infinity, or all zeroes', () => {
      const nanVector = [new Array(767).fill(0.1).concat([NaN])];
      assert.throws(() => validateVectorDimensions(nanVector, 768), IndexingIntegrityError);

      const zeroVector = [new Array(768).fill(0.0)];
      assert.throws(() => validateVectorDimensions(zeroVector, 768), IndexingIntegrityError);
    });

    it('should enforce metadata completeness on mandatory fields', () => {
      const completePayloads = [
        { document_id: 'DOC-1', chunk_index: 0, text: 'Some text', status: 'APPLICABLE' }
      ];
      const res = validateMetadataCompleteness(completePayloads);
      assert.strictEqual(res.valid, true);

      // Missing mandatory fields
      const incompletePayloads = [
        { document_id: 'DOC-1', chunk_index: 0, text: '' } // missing text and status
      ];
      assert.throws(
        () => validateMetadataCompleteness(incompletePayloads),
        MetadataCompletenessError
      );
    });

    it('should verify point count parity across chunks, embeddings, and point IDs', () => {
      const chunks = [{ text: 'a' }, { text: 'b' }];
      const embeddings = [[1, 2], [3, 4]];
      const pointIds = ['id-1', 'id-2'];

      assert.strictEqual(validatePointCounts(chunks, embeddings, pointIds).valid, true);

      // Count mismatch
      assert.throws(
        () => validatePointCounts(chunks, embeddings.slice(0, 1), pointIds),
        PointCountIntegrityError
      );
    });

    it('should capture and report failed indexing operations with stage information', async () => {
      // Attempt to index empty / unchunkable document
      await assert.rejects(
        async () => {
          await indexingService.indexDocument({
            documentId: 'EMPTY-DOC',
            title: 'Empty Procedure',
            text: ''
          });
        },
        (err) => {
          assert.ok(err instanceof FailedIndexingError || err.name === 'FailedIndexingError');
          assert.strictEqual(err.stage, 'CHUNKING');
          return true;
        }
      );
    });
  });

  describe('Task 6: Nearest Neighbor Query & Retrieval Verification', () => {
    it('should execute similarity search on indexed procedure chunks and return canonical links', async () => {
      await indexingService.indexCorpus(ALL_SYNTHETIC_DOCS);

      // Query for smoke and oxygen emergency checklist
      const queryEmb = await mockAdapter.embedQuery('smoke in cockpit emergency oxygen masks');
      const results = await indexingService.search(queryEmb.vector, 2);

      assert.ok(results.length > 0);
      assert.ok(results[0].score >= 0);
      assert.ok(results[0].text.length > 0);
      assert.ok(results[0].payload.document_id);
      assert.ok(results[0].canonicalDocument);
    });
  });
});

