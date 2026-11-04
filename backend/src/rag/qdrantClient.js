/**
 * ============================================================================
 * Milestone 3.31: Qdrant Vector Database Client & Collection Adapter
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Implements Qdrant REST client, in-memory test double for zero-dependency
 * local test environments, stable point UUID generation (RFC 4122), and safe
 * upsert semantics preserving vector-payload linkage.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

/**
 * UUID v5-compliant deterministic namespace for AeroRAG point IDs.
 * Generated from SHA-256 hash formatted as RFC 4122 UUID.
 */
const AERORAG_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Generates a stable, deterministic RFC 4122-compliant UUID for a document chunk.
 * Qdrant strictly requires point IDs to be either valid UUID strings or unsigned 64-bit integers.
 *
 * @param {string} documentId - Canonical document identifier (e.g. 'SOP-OPS-737-04')
 * @param {number|string} chunkIndex - Zero-based chunk index
 * @returns {string} Deterministic RFC 4122 UUID string
 */
export function generatePointId(documentId, chunkIndex) {
  if (!documentId) {
    throw new Error('generatePointId requires a valid documentId');
  }
  const cleanDoc = String(documentId).trim();
  const cleanIdx = String(chunkIndex !== undefined ? chunkIndex : 0).trim();
  const rawKey = `aerorag:${AERORAG_UUID_NAMESPACE}:${cleanDoc}:${cleanIdx}`;

  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

  // Format as RFC 4122 UUID: 8-4-4-4-12 hex chars
  // Version nibble set to '5' (name-based SHA)
  // Variant nibble set to 10xx (RFC 4122 variant, 8, 9, a, or b)
  const part1 = hash.slice(0, 8);
  const part2 = hash.slice(8, 12);
  const part3 = '5' + hash.slice(13, 16);
  const variantByte = (parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80;
  const part4 = variantByte.toString(16).padStart(2, '0') + hash.slice(18, 20);
  const part5 = hash.slice(20, 32);

  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

/**
 * Validates that an identifier satisfies Qdrant point ID requirements.
 * Valid point IDs are either unsigned integers or RFC 4122 UUID strings.
 *
 * @param {string|number} id - Candidate point identifier
 * @returns {boolean} True if compliant with Qdrant point ID specifications
 */
export function isValidPointId(id) {
  if (typeof id === 'number') {
    return Number.isInteger(id) && id >= 0;
  }
  if (typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id.trim());
}

/**
 * Computes cosine similarity between two float vectors.
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * In-Memory Qdrant Test Double.
 * Provides full Qdrant REST semantics for offline test execution, CI environments,
 * and deterministic unit testing without requiring an external container.
 */
export class InMemoryQdrantClient {
  constructor(options = {}) {
    this.collections = new Map();
    this.storagePath = options.storagePath || null;
    if (this.storagePath && fs.existsSync(this.storagePath)) {
      this.loadFromDisk();
    }
  }

  loadFromDisk() {
    try {
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const data = JSON.parse(raw);
      for (const [colName, colData] of Object.entries(data)) {
        const pointsMap = new Map();
        if (Array.isArray(colData.points)) {
          for (const pt of colData.points) {
            pointsMap.set(String(pt.id), pt);
          }
        }
        this.collections.set(colName, {
          name: colName,
          size: colData.size,
          distance: colData.distance || 'Cosine',
          points: pointsMap
        });
      }
    } catch (e) {
      logger.warn(`Could not load in-memory Qdrant storage: ${e.message}`);
    }
  }

  saveToDisk() {
    if (!this.storagePath) return;
    try {
      const dump = {};
      for (const [colName, col] of this.collections.entries()) {
        dump[colName] = {
          size: col.size,
          distance: col.distance,
          points: Array.from(col.points.values())
        };
      }
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(dump, null, 2), 'utf8');
    } catch (e) {
      logger.warn(`Could not save in-memory Qdrant storage: ${e.message}`);
    }
  }

  async checkHealth() {
    return {
      status: 'ok',
      title: 'qdrant - test double',
      version: '1.11.0-mock'
    };
  }

  async createCollection(name, { size = 768, distance = 'Cosine' } = {}) {
    if (!name || typeof name !== 'string') {
      throw new Error('Collection name must be a non-empty string');
    }
    const collection = {
      name,
      size: Number(size),
      distance,
      points: new Map()
    };
    this.collections.set(name, collection);
    this.saveToDisk();
    return { result: true, status: 'ok' };
  }

  async getCollection(name) {
    const col = this.collections.get(name);
    if (!col) {
      throw new Error(`Collection '${name}' not found`);
    }
    return {
      result: {
        status: 'green',
        vectors_count: col.points.size,
        points_count: col.points.size,
        config: {
          params: {
            vectors: {
              size: col.size,
              distance: col.distance
            }
          }
        }
      }
    };
  }

  async deleteCollection(name) {
    const deleted = this.collections.delete(name);
    this.saveToDisk();
    return { result: deleted };
  }

  /**
   * Upserts points with safe overwrite semantics.
   * If a point with the same ID already exists, its vector and payload are replaced.
   */
  async upsertPoints(name, points = [], { wait = true } = {}) {
    const col = this.collections.get(name);
    if (!col) {
      throw new Error(`Collection '${name}' does not exist. Call createCollection first.`);
    }

    const list = Array.isArray(points) ? points : [points];
    for (const point of list) {
      if (!isValidPointId(point.id)) {
        throw new Error(`Invalid Qdrant point id: '${point.id}'. Must be RFC 4122 UUID or positive integer.`);
      }
      if (!Array.isArray(point.vector)) {
        throw new Error(`Point '${point.id}' vector must be an array of numbers`);
      }
      if (point.vector.length !== col.size) {
        throw new Error(
          `Dimension mismatch: Collection '${col.name}' requires dimension ${col.size}, but received vector of length ${point.vector.length}`
        );
      }
      if (!point.payload || typeof point.payload !== 'object') {
        throw new Error(`Point '${point.id}' must include a metadata payload object`);
      }

      col.points.set(String(point.id), {
        id: point.id,
        vector: Array.from(point.vector),
        payload: JSON.parse(JSON.stringify(point.payload))
      });
    }

    this.saveToDisk();
    return {
      result: {
        operation_id: Date.now(),
        status: 'completed'
      },
      upsertedCount: list.length
    };
  }

  async getPoint(name, id) {
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection '${name}' not found`);
    const pt = col.points.get(String(id));
    if (!pt) return null;
    return {
      id: pt.id,
      vector: [...pt.vector],
      payload: { ...pt.payload }
    };
  }

  async getPoints(name, ids = []) {
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection '${name}' not found`);
    const results = [];
    for (const id of ids) {
      const pt = col.points.get(String(id));
      if (pt) {
        results.push({
          id: pt.id,
          vector: [...pt.vector],
          payload: { ...pt.payload }
        });
      }
    }
    return results;
  }

  /**
   * Deletes points by specific IDs or matching payload filter.
   */
  async deletePoints(name, { points = [], filter = null } = {}) {
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection '${name}' not found`);

    let deletedCount = 0;

    // Delete by explicit IDs
    if (Array.isArray(points) && points.length > 0) {
      for (const id of points) {
        if (col.points.delete(String(id))) {
          deletedCount++;
        }
      }
    }

    // Delete by payload filter
    if (filter) {
      const toDelete = [];
      for (const [id, pt] of col.points.entries()) {
        if (this._matchesFilter(pt.payload, filter)) {
          toDelete.push(id);
        }
      }
      for (const id of toDelete) {
        if (col.points.delete(id)) {
          deletedCount++;
        }
      }
    }

    if (deletedCount > 0) this.saveToDisk();
    return {
      result: {
        operation_id: Date.now(),
        status: 'completed',
        deleted_count: deletedCount
      }
    };
  }

  /**
   * Search nearest neighbors in collection using cosine similarity.
   */
  async search(name, {
    vector,
    limit = 5,
    filter = null,
    with_payload = true,
    with_vector = false,
    score_threshold = null
  } = {}) {
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection '${name}' not found`);

    if (!Array.isArray(vector) || vector.length !== col.size) {
      throw new Error(`Search vector dimension mismatch: expected ${col.size}, received ${vector?.length}`);
    }

    const scored = [];
    for (const pt of col.points.values()) {
      if (filter && !this._matchesFilter(pt.payload, filter)) {
        continue;
      }
      const score = cosineSimilarity(vector, pt.vector);
      if (score_threshold !== null && score < score_threshold) {
        continue;
      }
      scored.push({
        id: pt.id,
        version: 0,
        score,
        payload: with_payload ? { ...pt.payload } : undefined,
        vector: with_vector ? [...pt.vector] : undefined
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async countPoints(name, { filter = null, exact = true } = {}) {
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection '${name}' not found`);
    if (!filter) {
      return { result: { count: col.points.size } };
    }
    let matched = 0;
    for (const pt of col.points.values()) {
      if (this._matchesFilter(pt.payload, filter)) {
        matched++;
      }
    }
    return { result: { count: matched } };
  }

  _matchesFilter(payload, filter) {
    if (!filter || typeof filter !== 'object') return true;
    if (filter.must && Array.isArray(filter.must)) {
      return filter.must.every(cond => this._evaluateCondition(payload, cond));
    }
    if (filter.should && Array.isArray(filter.should)) {
      return filter.should.some(cond => this._evaluateCondition(payload, cond));
    }
    if (filter.must_not && Array.isArray(filter.must_not)) {
      return !filter.must_not.some(cond => this._evaluateCondition(payload, cond));
    }
    return this._evaluateCondition(payload, filter);
  }

  _evaluateCondition(payload, cond) {
    if (!cond || !cond.key) return true;
    const value = payload[cond.key];
    if (cond.match) {
      if (cond.match.value !== undefined) {
        return value === cond.match.value;
      }
      if (Array.isArray(cond.match.any)) {
        return cond.match.any.includes(value);
      }
    }
    return true;
  }
}

/**
 * Live Qdrant HTTP REST API Client.
 * Connects directly to Qdrant REST endpoints with native Node fetch.
 */
export class QdrantHttpClient {
  constructor(options = {}) {
    this.baseUrl = (options.url || 'http://localhost:6333').replace(/\/$/, '');
    this.apiKey = options.apiKey || null;
    this.timeoutMs = options.timeoutMs || 5000;
  }

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      h['api-key'] = this.apiKey;
    }
    return h;
  }

  async _request(endpoint, method = 'GET', body = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const res = await fetch(url, {
        method,
        headers: this._headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data?.status?.error || data?.message || `HTTP ${res.status} ${res.statusText}`;
        throw new Error(`Qdrant API error [${endpoint}]: ${errorMsg}`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkHealth() {
    return await this._request('/healthz');
  }

  async createCollection(name, { size = 768, distance = 'Cosine' } = {}) {
    return await this._request(`/collections/${name}`, 'PUT', {
      vectors: {
        size: Number(size),
        distance
      }
    });
  }

  async getCollection(name) {
    return await this._request(`/collections/${name}`, 'GET');
  }

  async deleteCollection(name) {
    return await this._request(`/collections/${name}`, 'DELETE');
  }

  async upsertPoints(name, points = [], { wait = true } = {}) {
    const list = Array.isArray(points) ? points : [points];
    const res = await this._request(`/collections/${name}/points?wait=${wait}`, 'PUT', {
      points: list
    });
    return { ...res, upsertedCount: list.length };
  }

  async getPoint(name, id) {
    try {
      const res = await this._request(`/collections/${name}/points/${id}`, 'GET');
      return res.result;
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('not found')) return null;
      throw e;
    }
  }

  async getPoints(name, ids = []) {
    const res = await this._request(`/collections/${name}/points`, 'POST', {
      ids,
      with_payload: true,
      with_vector: true
    });
    return res.result || [];
  }

  async deletePoints(name, { points = [], filter = null } = {}) {
    const payload = {};
    if (points.length > 0) payload.points = points;
    if (filter) payload.filter = filter;
    return await this._request(`/collections/${name}/points/delete`, 'POST', payload);
  }

  async search(name, {
    vector,
    limit = 5,
    filter = null,
    with_payload = true,
    with_vector = false
  } = {}) {
    const body = {
      vector,
      limit,
      with_payload,
      with_vector
    };
    if (filter) body.filter = filter;
    const res = await this._request(`/collections/${name}/points/search`, 'POST', body);
    return res.result || [];
  }

  async countPoints(name, { filter = null, exact = true } = {}) {
    const body = { exact };
    if (filter) body.filter = filter;
    return await this._request(`/collections/${name}/points/count`, 'POST', body);
  }
}

/**
 * Creates either a live QdrantHttpClient or an InMemoryQdrantClient.
 * Tests live connection reachability first; falls back gracefully to in-memory test double.
 */
export async function createQdrantClient(options = {}) {
  const url = options.url || process.env.QDRANT_URL || 'http://localhost:6333';
  const apiKey = options.apiKey || process.env.QDRANT_API_KEY || null;

  if (options.forceInMemory || options.mode === 'in-memory') {
    return new InMemoryQdrantClient(options);
  }

  const liveClient = new QdrantHttpClient({ url, apiKey, timeoutMs: options.timeoutMs || 1500 });
  try {
    await liveClient.checkHealth();
    logger.info(`Connected to live Qdrant at ${url}`);
    return liveClient;
  } catch (err) {
    logger.info(`Live Qdrant not reachable at ${url}; initialized high-fidelity in-memory Qdrant client.`);
    return new InMemoryQdrantClient(options);
  }
}

export default {
  generatePointId,
  isValidPointId,
  InMemoryQdrantClient,
  QdrantHttpClient,
  createQdrantClient
};

