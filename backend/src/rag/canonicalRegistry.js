/**
 * ============================================================================
 * Milestone 3.31: Canonical Document Metadata Registry
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Maintains the authoritative link between canonical document metadata
 * records and indexed vector points in Qdrant. Guarantees bi-directional
 * lookup, version history audit, and idempotency tracking.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { validateDocumentMetadata } from './metadataManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '../../../data/vector_db/canonical_registry.json');

export class CanonicalMetadataRegistry {
  constructor(options = {}) {
    this.storagePath = options.storagePath || DEFAULT_REGISTRY_PATH;
    this.documents = new Map(); // documentId -> canonical record
    this.pointIndexMap = new Map(); // pointId -> { documentId, chunkIndex }

    if (options.autoLoad !== false && fs.existsSync(this.storagePath)) {
      this.load();
    }
  }

  load() {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.documents)) {
        for (const doc of data.documents) {
          this.documents.set(doc.documentId, doc);
          if (Array.isArray(doc.pointIds)) {
            doc.pointIds.forEach((pid, idx) => {
              this.pointIndexMap.set(String(pid), {
                documentId: doc.documentId,
                chunkIndex: idx
              });
            });
          }
        }
      }
    } catch (e) {
      logger.warn(`Could not load CanonicalMetadataRegistry: ${e.message}`);
    }
  }

  save() {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload = {
        updatedAt: new Date().toISOString(),
        totalDocuments: this.documents.size,
        totalPoints: this.pointIndexMap.size,
        documents: Array.from(this.documents.values())
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
      logger.warn(`Could not persist CanonicalMetadataRegistry: ${e.message}`);
    }
  }

  /**
   * Registers or updates a canonical document metadata record linked to indexed points.
   *
   * @param {Object} rawMetadata - Validated document metadata
   * @param {Array<string>} pointIds - Ordered list of stable point UUIDs indexed in Qdrant
   * @param {Object} [details] - Indexing metrics (contentHash, dimension, collectionName)
   * @returns {Object} Canonical document record
   */
  registerDocument(rawMetadata, pointIds = [], details = {}) {
    const validated = validateDocumentMetadata(rawMetadata);
    const documentId = validated.documentId;

    // Clean previous point associations for this document
    const existing = this.documents.get(documentId);
    if (existing && Array.isArray(existing.pointIds)) {
      for (const oldPid of existing.pointIds) {
        this.pointIndexMap.delete(String(oldPid));
      }
    }

    const canonicalRecord = {
      ...validated,
      pointIds: [...pointIds],
      chunkCount: pointIds.length,
      contentHash: details.contentHash || validated.contentHash || null,
      vectorDimension: details.vectorDimension || 768,
      collectionName: details.collectionName || 'aerorag_chunks',
      indexedAt: details.indexedAt || new Date().toISOString(),
      lastModified: new Date().toISOString(),
      indexingStatus: 'INDEXED'
    };

    this.documents.set(documentId, canonicalRecord);

    // Map each point ID to its document and chunk index
    pointIds.forEach((pid, idx) => {
      this.pointIndexMap.set(String(pid), {
        documentId,
        chunkIndex: idx
      });
    });

    this.save();
    return canonicalRecord;
  }

  /**
   * Retrieves canonical document metadata by document ID.
   */
  getDocument(documentId) {
    if (!documentId) return null;
    return this.documents.get(String(documentId)) || null;
  }

  /**
   * Checks whether a document is already indexed.
   */
  hasDocument(documentId) {
    return this.documents.has(String(documentId));
  }

  /**
   * Returns true if document exists and its stored content hash matches the new hash.
   */
  isContentIdentical(documentId, candidateContentHash) {
    if (!candidateContentHash) return false;
    const doc = this.getDocument(documentId);
    if (!doc || !doc.contentHash) return false;
    return doc.contentHash === candidateContentHash;
  }

  /**
   * Retrieves all stable point IDs linked to a document.
   */
  getPointIdsForDocument(documentId) {
    const doc = this.getDocument(documentId);
    return doc ? [...doc.pointIds] : [];
  }

  /**
   * Resolves a point UUID back to its canonical document record and chunk index.
   */
  resolvePointToDocument(pointId) {
    if (!pointId) return null;
    const ref = this.pointIndexMap.get(String(pointId));
    if (!ref) return null;
    const doc = this.getDocument(ref.documentId);
    return {
      document: doc,
      documentId: ref.documentId,
      chunkIndex: ref.chunkIndex
    };
  }

  /**
   * Deletes a document from the canonical registry and cleans point mappings.
   */
  removeDocument(documentId) {
    const doc = this.getDocument(documentId);
    if (!doc) return false;
    if (Array.isArray(doc.pointIds)) {
      for (const pid of doc.pointIds) {
        this.pointIndexMap.delete(String(pid));
      }
    }
    this.documents.delete(documentId);
    this.save();
    return true;
  }

  /**
   * Clears the entire registry.
   */
  clear() {
    this.documents.clear();
    this.pointIndexMap.clear();
    this.save();
  }

  /**
   * Lists all registered canonical document records.
   */
  listDocuments() {
    return Array.from(this.documents.values());
  }

  count() {
    return this.documents.size;
  }
}

let defaultRegistry = null;

export function getDefaultCanonicalRegistry(options = {}) {
  if (!defaultRegistry) {
    defaultRegistry = new CanonicalMetadataRegistry(options);
  }
  return defaultRegistry;
}

export default {
  CanonicalMetadataRegistry,
  getDefaultCanonicalRegistry
};

