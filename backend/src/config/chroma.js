import { ChromaClient } from 'chromadb';
import config from './env.js';
import logger from '../utils/logger.js';

const client = new ChromaClient({ path: config.VECTOR_DB_URL });

export const getChromaClient = () => {
  return client;
};

export const getCollection = async (name) => {
  try {
    return await client.getOrCreateCollection({ name });
  } catch (error) {
    logger.error(`ChromaDB Error: ${error.message}`);
    throw error;
  }
};
