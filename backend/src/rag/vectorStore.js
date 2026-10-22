import { createCollection, DEFAULT_COLLECTION_CONFIG } from './collectionManager.js';
import logger from '../utils/logger.js';

let activeCollection = null;

async function getOrInitCollection() {
  if (!activeCollection) {
    activeCollection = await createCollection(DEFAULT_COLLECTION_CONFIG);
  }
  return activeCollection;
}

export const upsertChunks = async (chunks, embeddings, metadatas, ids) => {
  const collection = await getOrInitCollection();
  const records = [];

  for (let i = 0; i < ids.length; i++) {
    records.push({
      id: ids[i],
      vector: embeddings[i],
      text: chunks[i],
      metadata: {
        source: metadatas[i].documentId || metadatas[i].source || 'UNKNOWN',
        document_title: metadatas[i].documentTitle || '',
        document_type: metadatas[i].documentType || '',
        status: metadatas[i].status || 'APPROVED',
        effective_date: metadatas[i].effectiveDate || '',
        chunk_index: metadatas[i].chunkIndex !== undefined ? metadatas[i].chunkIndex : i,
        section: metadatas[i].section || '',
        ...metadatas[i]
      }
    });
  }

  await collection.upsert(records);
  logger.info(`Successfully upserted ${records.length} chunks to vector store.`);
  return { upsertedCount: records.length };
};

export const deleteDocumentChunks = async (documentId) => {
  const collection = await getOrInitCollection();
  let deletedCount = 0;
  for (const [id, record] of collection.records.entries()) {
    if (record.metadata.source === documentId || record.metadata.documentId === documentId) {
      collection.records.delete(id);
      deletedCount++;
    }
  }
  if (deletedCount > 0) {
    collection.saveToDisk();
  }
  logger.info(`Deleted ${deletedCount} chunks for document ${documentId}`);
  return deletedCount;
};

export const querySimilar = async (queryEmbedding, topK = 5) => {
  const collection = await getOrInitCollection();
  const results = await collection.query(queryEmbedding, topK);

  return results.map(r => ({
    score: r.score,
    distance: r.distance,
    metadata: r.metadata,
    document: r.text
  }));
};

export const getRecordById = async (id) => {
  const collection = await getOrInitCollection();
  return await collection.get(id);
};
