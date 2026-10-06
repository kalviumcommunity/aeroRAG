import { getCollection } from '../config/chroma.js';
import logger from '../utils/logger.js';
import config from '../config/env.js';

// In-memory fallback
let inMemoryStore = [];

function cosineSimilarity(vecA, vecB) {
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

export const upsertChunks = async (chunks, embeddings, metadatas, ids) => {
  try {
    const collection = await getCollection('aerorag_chunks');
    await collection.add({
      ids: ids,
      embeddings: embeddings,
      metadatas: metadatas,
      documents: chunks
    });
    logger.info(`Successfully upserted ${ids.length} chunks to ChromaDB.`);
  } catch (error) {
    logger.error(`Failed to upsert to ChromaDB, using in-memory store. Error: ${error.message}`);
    // In-memory fallback
    for (let i = 0; i < ids.length; i++) {
      // Remove existing
      inMemoryStore = inMemoryStore.filter(item => item.id !== ids[i]);
      inMemoryStore.push({
        id: ids[i],
        embedding: embeddings[i],
        metadata: metadatas[i],
        document: chunks[i]
      });
    }
  }
};

export const deleteDocumentChunks = async (documentId) => {
  try {
    const collection = await getCollection('aerorag_chunks');
    await collection.delete({
      where: { documentId: documentId }
    });
    logger.info(`Deleted chunks for document ${documentId} from ChromaDB`);
  } catch (error) {
    logger.warn(`Failed to delete from ChromaDB, checking in-memory store. Error: ${error.message}`);
    inMemoryStore = inMemoryStore.filter(item => item.metadata.documentId !== documentId);
  }
};

export const querySimilar = async (queryEmbedding, topK = 5) => {
  try {
    const collection = await getCollection('aerorag_chunks');
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK
    });
    
    const formattedResults = [];
    if (results.ids[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        formattedResults.push({
          score: results.distances[0][i], // Note: Chroma returns distance, lower is more similar
          metadata: results.metadatas[0][i],
          document: results.documents[0][i]
        });
      }
    }
    return formattedResults;
  } catch (error) {
    logger.warn(`ChromaDB query failed, using in-memory store fallback. Error: ${error.message}`);
    // Fallback search
    let scored = inMemoryStore.map(item => ({
      ...item,
      score: cosineSimilarity(queryEmbedding, item.embedding)
    }));
    // Sort descending by score for cosine similarity (higher is better)
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(item => ({
      score: item.score,
      metadata: item.metadata,
      document: item.document
    }));
  }
};
