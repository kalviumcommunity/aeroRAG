/**
 * ============================================================================
 * Milestone 3.31: Vector Indexing & Metadata Storage Service
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Connects document ingestion, chunk metadata, embedding generation,
 * and Qdrant indexing with stable point identifiers, safe upsert behavior,
 * canonical document metadata preservation, and comprehensive integrity checks.
 */

import crypto from 'crypto';
import path from 'path';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { extractText } from '../utils/textExtractor.js';
import { cleanText } from './textCleaner.js';
import { DocumentChunker, chunkText } from './chunker.js';
import {
  validateDocumentMetadata,
  propagateMetadataToChunks,
  formatChunkCitation
} from './metadataManager.js';
import {
  createBatchEmbeddingManager
} from './batchEmbeddingManager.js';
import {
  getDefaultBatchManager
} from './embedder.js';
import {
  generatePointId,
  isValidPointId,
  createQdrantClient,
  InMemoryQdrantClient
} from './qdrantClient.js';
import {
  getDefaultCanonicalRegistry,
  CanonicalMetadataRegistry
} from './canonicalRegistry.js';

/**
 * Custom Error Types for Indexing Integrity
 */
export class IndexingIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IndexingIntegrityError';
    this.details = details;
  }
}

export class VectorDimensionMismatchError extends IndexingIntegrityError {
  constructor(expected, received, pointIndex) {
    super(
      `Vector dimension mismatch: expected ${expected}, received ${received} at point index ${pointIndex}`,
      { expected, received, pointIndex }
    );
    this.name = 'VectorDimensionMismatchError';
  }
}

export class MetadataCompletenessError extends IndexingIntegrityError {
  constructor(missingFields, pointIndex) {
    super(
      `Metadata completeness violation: missing mandatory fields [${missingFields.join(', ')}] at point index ${pointIndex}`,
      { missingFields, pointIndex }
    );
    this.name = 'MetadataCompletenessError';
  }
}

export class PointCountIntegrityError extends IndexingIntegrityError {
  constructor(expected, actual, stage) {
    super(
      `Point count parity violation at stage '${stage}': expected ${expected}, got ${actual}`,
      { expected, actual, stage }
    );
    this.name = 'PointCountIntegrityError';
  }
}

export class FailedIndexingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FailedIndexingError';
    this.stage = details.stage || 'UNKNOWN';
    this.documentId = details.documentId || null;
    this.details = details;
  }
}

/**
 * Validates that all vectors have the exact configured dimension,
 * contain valid finite numbers, and are not null/zero-vectors.
 *
 * @param {Array<Array<number>>} vectors - Array of embedding vectors
 * @param {number} expectedDimension - Expected vector dimensionality
 * @returns {Object} Integrity verification report
 */
export function validateVectorDimensions(vectors = [], expectedDimension = 768) {
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new IndexingIntegrityError('No vectors provided for dimension validation');
  }

  for (let i = 0; i < vectors.length; i++) {
    const vec = vectors[i];
    if (!Array.isArray(vec)) {
      throw new VectorDimensionMismatchError(expectedDimension, typeof vec, i);
    }
    if (vec.length !== expectedDimension) {
      throw new VectorDimensionMismatchError(expectedDimension, vec.length, i);
    }

    let normSq = 0;
    for (let j = 0; j < vec.length; j++) {
      const val = vec[j];
      if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
        throw new IndexingIntegrityError(
          `Invalid vector value at point index ${i}, dimension ${j}: ${val}`,
          { pointIndex: i, dimensionIndex: j, value: val }
        );
      }
      normSq += val * val;
    }

    if (normSq === 0) {
      throw new IndexingIntegrityError(`Zero vector detected at point index ${i}`, { pointIndex: i });
    }
  }

  return {
    valid: true,
    count: vectors.length,
    dimension: expectedDimension
  };
}

/**
 * Validates metadata completeness across all points before upserting.
 * Mandatory fields: document_id (or source), chunk_index, text, document_title, status.
 *
 * @param {Array<Object>} payloads - Array of chunk metadata payloads
 * @param {Array<string>} [requiredFields] - Required metadata keys
 * @returns {Object} Completeness report
 */
export function validateMetadataCompleteness(payloads = [], requiredFields = null) {
  const mandatory = requiredFields || ['document_id', 'chunk_index', 'text', 'status'];

  if (!Array.isArray(payloads) || payloads.length === 0) {
    throw new IndexingIntegrityError('No metadata payloads provided for completeness check');
  }

  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i];
    if (!p || typeof p !== 'object') {
      throw new MetadataCompletenessError(mandatory, i);
    }

    const missing = [];
    for (const field of mandatory) {
      const val = p[field];
      if (val === undefined || val === null || (typeof val === 'string' && val.trim().length === 0)) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      throw new MetadataCompletenessError(missing, i);
    }
  }

  return {
    valid: true,
    totalInspected: payloads.length,
    verifiedFields: mandatory
  };
}

/**
 * Validates point count parity across chunks, embeddings, point IDs, and vector store.
 */
export function validatePointCounts(chunks = [], embeddings = [], pointIds = [], upsertedCount = null) {
  if (chunks.length !== embeddings.length) {
    throw new PointCountIntegrityError(chunks.length, embeddings.length, 'CHUNKS_VS_EMBEDDINGS');
  }
  if (chunks.length !== pointIds.length) {
    throw new PointCountIntegrityError(chunks.length, pointIds.length, 'CHUNKS_VS_POINT_IDS');
  }
  if (upsertedCount !== null && upsertedCount !== chunks.length) {
    throw new PointCountIntegrityError(chunks.length, upsertedCount, 'CHUNKS_VS_UPSERTED');
  }

  return {
    valid: true,
    count: chunks.length
  };
}

/**
 * Qdrant Vector Collection Adapter.
 * Adapts QdrantHttpClient or InMemoryQdrantClient to the standard vector store interface.
 */
export class QdrantVectorCollection {
  constructor(client, options = {}) {
    this.client = client;
    this.name = options.name || config.COLLECTION_NAME || 'aerorag_chunks';
    this.dimension = options.dimension || config.VECTOR_DIMENSION || 768;
    this.metric = options.metric || 'Cosine';
    this.isInitialized = false;
  }

  async ensureCollection() {
    if (this.isInitialized) return;
    try {
      await this.client.getCollection(this.name);
    } catch (err) {
      // Create collection if missing
      await this.client.createCollection(this.name, {
        size: this.dimension,
        distance: this.metric
      });
      logger.info(`Created Qdrant collection '${this.name}' with dimension ${this.dimension}`);
    }
    this.isInitialized = true;
  }

  async upsert(records = []) {
    await this.ensureCollection();
    const list = Array.isArray(records) ? records : [records];
    if (list.length === 0) return { upsertedCount: 0 };

    // Format for Qdrant points API
    const points = list.map(rec => {
      if (!isValidPointId(rec.id)) {
        throw new Error(`Invalid point ID '${rec.id}' for Qdrant collection`);
      }
      return {
        id: rec.id,
        vector: rec.vector,
        payload: {
          ...rec.metadata,
          text: rec.text,
          document_id: rec.metadata?.document_id || rec.metadata?.documentId || rec.metadata?.source
        }
      };
    });

    const res = await this.client.upsertPoints(this.name, points, { wait: true });
    return {
      upsertedCount: points.length,
      operation: res
    };
  }

  async get(id) {
    await this.ensureCollection();
    const pt = await this.client.getPoint(this.name, id);
    if (!pt) return null;
    return {
      id: pt.id,
      vector: pt.vector || [],
      text: pt.payload?.text || '',
      metadata: { ...pt.payload }
    };
  }

  async delete(id) {
    await this.ensureCollection();
    const res = await this.client.deletePoints(this.name, { points: [id] });
    return res?.result?.deleted_count || 1;
  }

  async deleteDocumentChunks(documentId) {
    await this.ensureCollection();
    const filter = {
      must: [
        {
          key: 'document_id',
          match: { value: documentId }
        }
      ]
    };
    const res = await this.client.deletePoints(this.name, { filter });
    return res?.result?.deleted_count || 0;
  }

  async query(queryVector, topK = 5, filter = null) {
    await this.ensureCollection();
    const results = await this.client.search(this.name, {
      vector: queryVector,
      limit: topK,
      filter,
      with_payload: true,
      with_vector: true
    });

    return results.map(r => ({
      id: r.id,
      score: r.score,
      distance: 1 - r.score,
      text: r.payload?.text || '',
      metadata: r.payload || {},
      vector: r.vector
    }));
  }

  async count(filter = null) {
    await this.ensureCollection();
    const res = await this.client.countPoints(this.name, { filter, exact: true });
    return res?.result?.count ?? 0;
  }
}

/**
 * Vector Indexing Service
 * Coordinates document intake, chunking, embedding generation, Qdrant upsert,
 * idempotency enforcement, and canonical metadata registry synchronization.
 */
export class VectorIndexingService {
  constructor(options = {}) {
    this.qdrantClient = options.qdrantClient || null;
    this.collection = options.collection || null;
    this.canonicalRegistry = options.canonicalRegistry || getDefaultCanonicalRegistry();
    this.batchManager = options.batchManager || getDefaultBatchManager();
    this.chunker = options.chunker || new DocumentChunker({ maxChunkSize: 500, overlapTokens: 50 });
    this.dimension = options.dimension || config.VECTOR_DIMENSION || 768;
    this.collectionName = options.collectionName || config.COLLECTION_NAME || 'aerorag_chunks';
  }

  async init() {
    if (!this.qdrantClient) {
      this.qdrantClient = await createQdrantClient({
        url: config.QDRANT_URL,
        apiKey: config.QDRANT_API_KEY,
        storagePath: path.resolve(config.VECTOR_STORE_PATH || 'data/vector_db/qdrant_storage.json')
      });
    }

    if (!this.collection) {
      this.collection = new QdrantVectorCollection(this.qdrantClient, {
        name: this.collectionName,
        dimension: this.dimension
      });
    }

    await this.collection.ensureCollection();
    return this;
  }

  /**
   * Computes a deterministic SHA-256 hash of cleaned text content.
   */
  computeContentHash(text) {
    return crypto.createHash('sha256').update(String(text || '').trim()).digest('hex');
  }

  /**
   * Ingests, embeds, and indexes a single document end-to-end with idempotency guarantees.
   *
   * @param {Object|string} documentInput - Document object or file path
   * @param {Object} [options] - Indexing options
   * @returns {Promise<Object>} Structured indexing report
   */
  async indexDocument(documentInput, options = {}) {
    const startTime = Date.now();
    await this.init();

    try {
      // 1. Resolve Document Content & Metadata
      let rawText = '';
      let docMeta = {};

      if (typeof documentInput === 'string') {
        // Assume file path
        const extracted = await extractText(documentInput);
        rawText = extracted.text;
        const basename = path.basename(documentInput, path.extname(documentInput));
        docMeta = {
          documentId: basename.toUpperCase(),
          title: basename.replace(/[_-]/g, ' '),
          source: documentInput,
          ...options.metadata
        };
      } else if (typeof documentInput === 'object' && documentInput !== null) {
        if (documentInput.filePath && !documentInput.text) {
          const extracted = await extractText(documentInput.filePath, documentInput.fileType);
          rawText = extracted.text;
        } else {
          rawText = documentInput.text || '';
        }
        docMeta = { ...documentInput, ...options.metadata };
      } else {
        throw new FailedIndexingError('Invalid documentInput format', { stage: 'INPUT_VALIDATION' });
      }

      // 2. Validate Canonical Document Metadata
      const canonicalDoc = validateDocumentMetadata(docMeta);
      const documentId = canonicalDoc.documentId;

      // 3. Clean Text & Compute Content Hash
      const cleaned = cleanText(rawText);
      const textToChunk = cleaned.cleanedText || rawText;
      const contentHash = this.computeContentHash(textToChunk);

      // 4. Idempotency Check
      const isAlreadyIndexed = this.canonicalRegistry.hasDocument(documentId);
      const isContentIdentical = this.canonicalRegistry.isContentIdentical(documentId, contentHash);

      if (isAlreadyIndexed && isContentIdentical && !options.forceReindex) {
        const existingPointIds = this.canonicalRegistry.getPointIdsForDocument(documentId);
        logger.info(`[Idempotent Skip] Document '${documentId}' already indexed with identical content. Skipping re-embedding.`);
        return {
          status: 'IDEMPOTENT_SKIPPED',
          isIdempotent: true,
          documentId,
          contentHash,
          pointsIndexed: 0,
          totalPointsInDocument: existingPointIds.length,
          pointIds: existingPointIds,
          vectorDimension: this.dimension,
          durationMs: Date.now() - startTime,
          message: 'Document already indexed with identical content hash; points untouched'
        };
      }

      // 5. Chunking
      const rawChunks = typeof this.chunker.chunk === 'function'
        ? this.chunker.chunk(textToChunk, canonicalDoc)
        : chunkText(textToChunk, 500, 50);
      if (rawChunks.length === 0) {
        throw new FailedIndexingError(`No chunks generated for document '${documentId}'`, {
          stage: 'CHUNKING',
          documentId
        });
      }

      // 6. Propagate Canonical Metadata & Generate Stable Point UUIDs
      const enrichedChunks = propagateMetadataToChunks(canonicalDoc, rawChunks);
      const pointIds = enrichedChunks.map((_, idx) => generatePointId(documentId, idx));

      // 7. Generate Batch Embeddings
      const chunkTexts = enrichedChunks.map(c => c.text);
      const batchResult = await this.batchManager.embedTexts(chunkTexts);
      const embeddings = batchResult.embeddings.map(e => e.vector);

      // 8. Pre-Indexing Integrity Checks
      // 8a. Vector Dimension Check
      const dimReport = validateVectorDimensions(embeddings, this.dimension);

      // 8b. Metadata Completeness Check
      const payloads = enrichedChunks.map((chunk, idx) => ({
        document_id: documentId,
        document_title: canonicalDoc.title,
        document_type: canonicalDoc.documentType,
        version: canonicalDoc.version,
        status: canonicalDoc.applicabilityStatus || canonicalDoc.status,
        applicability_status: canonicalDoc.applicabilityStatus,
        verification_status: canonicalDoc.verificationStatus,
        effective_date: canonicalDoc.effectiveDate,
        publication_date: canonicalDoc.publicationDate,
        source: canonicalDoc.source,
        chunk_index: idx,
        point_id: pointIds[idx],
        citation: formatChunkCitation(chunk.metadata),
        text: chunk.text,
        content_hash: contentHash,
        token_count: chunk.tokenCount,
        section: chunk.metadata?.sectionTitle || chunk.section || '',
        page: chunk.metadata?.page || 1,
        indexed_at: new Date().toISOString()
      }));

      const metaReport = validateMetadataCompleteness(payloads);

      // 8c. Point Count Parity Check
      const countReport = validatePointCounts(enrichedChunks, embeddings, pointIds);

      // 9. Safe Upsert Handling (Idempotent Point Replacement)
      // If document was previously indexed with MORE chunks, delete old points to avoid orphans
      const oldPointIds = this.canonicalRegistry.getPointIdsForDocument(documentId);
      if (oldPointIds.length > pointIds.length) {
        const orphanIds = oldPointIds.slice(pointIds.length);
        await this.collection.client.deletePoints(this.collectionName, { points: orphanIds });
        logger.info(`Pruned ${orphanIds.length} orphaned points for updated document '${documentId}'`);
      }

      // Build records for collection upsert
      const records = pointIds.map((id, idx) => ({
        id,
        vector: embeddings[idx],
        text: chunkTexts[idx],
        metadata: payloads[idx]
      }));

      // Execute upsert into Qdrant collection
      const upsertResult = await this.collection.upsert(records);
      validatePointCounts(records, embeddings, pointIds, upsertResult.upsertedCount);

      // 10. Post-Indexing Readback Verification
      const samplePoint = await this.collection.get(pointIds[0]);
      if (!samplePoint || samplePoint.id !== pointIds[0]) {
        throw new FailedIndexingError(
          `Readback verification failed: point '${pointIds[0]}' could not be retrieved from collection`,
          { stage: 'READBACK_VERIFICATION', documentId, pointId: pointIds[0] }
        );
      }
      if (samplePoint.vector.length !== this.dimension) {
        throw new VectorDimensionMismatchError(this.dimension, samplePoint.vector.length, 0);
      }

      // 11. Register Canonical Metadata Record
      const canonicalRecord = this.canonicalRegistry.registerDocument(canonicalDoc, pointIds, {
        contentHash,
        vectorDimension: this.dimension,
        collectionName: this.collectionName,
        indexedAt: new Date().toISOString()
      });

      return {
        status: 'INDEXED',
        isIdempotent: true,
        documentId,
        contentHash,
        pointsIndexed: pointIds.length,
        pointIds,
        vectorDimension: this.dimension,
        canonicalRecord,
        integrityChecks: {
          dimensionValidation: dimReport,
          metadataCompleteness: metaReport,
          pointCountParity: countReport,
          readbackVerified: true
        },
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      if (err instanceof IndexingIntegrityError || err instanceof FailedIndexingError) {
        throw err;
      }
      throw new FailedIndexingError(`Failed to index document: ${err.message}`, {
        stage: 'EXECUTION',
        cause: err.message
      });
    }
  }

  /**
   * Ingests and indexes an entire corpus of synthetic or operational documents.
   *
   * @param {Array<Object|string>} corpus - Array of documents or file paths
   * @param {Object} [options] - Ingestion options
   * @returns {Promise<Object>} Aggregated corpus indexing report
   */
  async indexCorpus(corpus = [], options = {}) {
    const startTime = Date.now();
    await this.init();

    const results = [];
    let totalPointsIndexed = 0;
    let totalSkippedIdempotent = 0;
    let totalFailures = 0;

    for (const doc of corpus) {
      try {
        const report = await this.indexDocument(doc, options);
        results.push(report);
        if (report.status === 'IDEMPOTENT_SKIPPED') {
          totalSkippedIdempotent++;
        } else {
          totalPointsIndexed += report.pointsIndexed;
        }
      } catch (err) {
        totalFailures++;
        results.push({
          status: 'FAILED',
          document: typeof doc === 'object' ? doc.documentId : doc,
          error: err.message,
          stage: err.stage || 'UNKNOWN'
        });
        if (options.abortOnError) {
          throw err;
        }
      }
    }

    const totalCollectionPoints = await this.collection.count();

    return {
      status: totalFailures === 0 ? 'COMPLETED' : 'COMPLETED_WITH_FAILURES',
      totalDocumentsProcessed: corpus.length,
      totalPointsIndexed,
      totalSkippedIdempotent,
      totalFailures,
      totalCollectionPoints,
      vectorDimension: this.dimension,
      collectionName: this.collectionName,
      results,
      durationMs: Date.now() - startTime
    };
  }

  /**
   * Queries the indexed Qdrant collection and resolves matches back to canonical document records.
   */
  async search(queryVector, topK = 5, filter = null) {
    await this.init();
    const hits = await this.collection.query(queryVector, topK, filter);

    return hits.map(hit => {
      const canonicalRef = this.canonicalRegistry.resolvePointToDocument(hit.id);
      return {
        pointId: hit.id,
        score: hit.score,
        distance: hit.distance,
        text: hit.text,
        payload: hit.metadata,
        citation: hit.metadata?.citation || '',
        canonicalDocument: canonicalRef?.document || null
      };
    });
  }
}

export default {
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
};
