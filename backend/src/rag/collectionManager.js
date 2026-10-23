import fs from 'fs';
import path from 'path';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { getCollection, checkVectorDbHealth } from '../config/chroma.js';

export const DEFAULT_COLLECTION_CONFIG = {
  name: config.COLLECTION_NAME || 'aerorag_chunks',
  dimension: config.VECTOR_DIMENSION || 768,
  metric: config.VECTOR_METRIC || 'cosine'
};

export const RECORD_SCHEMA_DEFINITION = {
  type: "object",
  properties: {
    id: { type: "string", description: "Stable unique chunk identifier, e.g. 'doc-id:chunk_0'" },
    vector: { type: "array", items: "number", description: "Dense embedding vector of length matching dimension" },
    text: { type: "string", description: "Original plain text of the document chunk" },
    metadata: {
      type: "object",
      properties: {
        source: { type: "string", description: "Source document filename or identifier" },
        document_title: { type: "string", description: "Human-readable manual/bulletin title" },
        document_type: { type: "string", description: "Classification e.g. Operational Manual, Safety Bulletin" },
        status: { type: "string", description: "Lifecycle state e.g. APPROVED, SUPERSEDED" },
        effective_date: { type: "string", description: "Effective regulatory date (YYYY-MM-DD)" },
        chunk_index: { type: "integer", description: "Position of chunk within the document" },
        section: { type: "string", description: "Section header or checklist category" },
        page: { type: "integer", description: "Page number if applicable" }
      },
      required: ["source", "chunk_index"]
    }
  },
  required: ["id", "vector", "text", "metadata"]
};

/**
 * Validates a record against collection dimension and schema requirements
 */
export function validateRecord(record, expectedDimension) {
  if (!record || typeof record !== 'object') {
    throw new Error('Record must be a non-null object');
  }

  if (!record.id || typeof record.id !== 'string') {
    throw new Error(`Record must have a non-empty string 'id', received: ${record.id}`);
  }

  if (!Array.isArray(record.vector)) {
    throw new Error(`Record 'vector' must be an array of numbers, received: ${typeof record.vector}`);
  }

  if (record.vector.length !== expectedDimension) {
    throw new Error(
      `Dimension mismatch: Collection '${expectedDimension}' requires ${expectedDimension}-dimensional vectors, but received ${record.vector.length}`
    );
  }

  if (typeof record.text !== 'string' || record.text.trim().length === 0) {
    throw new Error(`Record 'text' must be a non-empty string`);
  }

  if (!record.metadata || typeof record.metadata !== 'object') {
    throw new Error(`Record 'metadata' must be an object`);
  }

  if (!record.metadata.source) {
    throw new Error(`Record metadata missing required field: 'source'`);
  }

  if (record.metadata.chunk_index === undefined || typeof record.metadata.chunk_index !== 'number') {
    throw new Error(`Record metadata missing required numeric field: 'chunk_index'`);
  }

  return true;
}

/**
 * Computes cosine similarity between two vectors
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error(`Vector length mismatch: ${vecA.length} vs ${vecB.length}`);
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Collection abstraction providing unified API across ChromaDB or local persistent store
 */
export class VectorCollection {
  constructor(options = {}) {
    this.name = options.name || DEFAULT_COLLECTION_CONFIG.name;
    this.dimension = options.dimension || DEFAULT_COLLECTION_CONFIG.dimension;
    this.metric = options.metric || DEFAULT_COLLECTION_CONFIG.metric;
    this.metadata = {
      "hnsw:space": this.metric,
      "dimension": this.dimension,
      "description": "AeroRAG airline procedure verification chunks"
    };

    this.storageDir = path.resolve(process.cwd(), 'data/vector_db');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    this.storageFile = path.join(this.storageDir, `${this.name}.json`);

    this.records = new Map();
    this.loadFromDisk();
  }

  loadFromDisk() {
    if (fs.existsSync(this.storageFile)) {
      try {
        const raw = fs.readFileSync(this.storageFile, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          data.forEach(item => this.records.set(item.id, item));
        }
      } catch (e) {
        logger.warn(`Could not read persistent collection file: ${e.message}`);
      }
    }
  }

  saveToDisk() {
    try {
      const data = Array.from(this.records.values());
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      logger.warn(`Could not persist collection file: ${e.message}`);
    }
  }

  /**
   * Upsert one or more records with strict dimension and schema validation
   */
  async upsert(records) {
    const list = Array.isArray(records) ? records : [records];
    for (const record of list) {
      validateRecord(record, this.dimension);
      this.records.set(record.id, {
        id: record.id,
        vector: Array.from(record.vector),
        text: record.text,
        metadata: { ...record.metadata }
      });
    }
    this.saveToDisk();
    return { upsertedCount: list.length };
  }

  /**
   * Read back a stored record by ID
   */
  async get(id) {
    const record = this.records.get(id);
    if (!record) return null;
    return {
      id: record.id,
      vector: [...record.vector],
      text: record.text,
      metadata: { ...record.metadata }
    };
  }

  /**
   * Delete a record by ID
   */
  async delete(id) {
    const deleted = this.records.delete(id);
    if (deleted) this.saveToDisk();
    return deleted;
  }

  /**
   * Search nearest neighbors using cosine similarity
   */
  async query(queryVector, topK = 5) {
    if (queryVector.length !== this.dimension) {
      throw new Error(`Query vector dimension mismatch: expected ${this.dimension}, got ${queryVector.length}`);
    }

    const scored = [];
    for (const record of this.records.values()) {
      const similarity = cosineSimilarity(queryVector, record.vector);
      scored.push({
        id: record.id,
        score: similarity,
        distance: 1 - similarity,
        text: record.text,
        metadata: record.metadata
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  count() {
    return this.records.size;
  }
}

/**
 * Creates or retrieves a vector database collection with dimension enforcement
 */
export async function createCollection(options = {}) {
  const collectionConfig = {
    name: options.name || DEFAULT_COLLECTION_CONFIG.name,
    dimension: options.dimension || DEFAULT_COLLECTION_CONFIG.dimension,
    metric: options.metric || DEFAULT_COLLECTION_CONFIG.metric
  };

  return new VectorCollection(collectionConfig);
}
