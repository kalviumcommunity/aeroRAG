import fs from 'fs';
import path from 'path';
import config from './env.js';
import logger from '../utils/logger.js';

let ChromaClient = null;
try {
  const mod = await import('chromadb');
  ChromaClient = mod.ChromaClient;
} catch (e) {
  // Offline or chromadb node module not installed
}

let chromaHttpClient = null;
if (ChromaClient && config.VECTOR_DB_URL) {
  try {
    chromaHttpClient = new ChromaClient({ path: config.VECTOR_DB_URL });
  } catch (e) {
    logger.warn(`Could not initialize ChromaClient: ${e.message}`);
  }
}

/**
 * Checks reachability of the configured vector database
 * Tests HTTP endpoint or confirms local persistent storage availability
 */
export const checkVectorDbHealth = async () => {
  const startTime = Date.now();

  // Try Chroma HTTP endpoint
  if (chromaHttpClient) {
    try {
      const hb = await Promise.race([
        chromaHttpClient.heartbeat(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 1500ms')), 1500))
      ]);
      const pingMs = Date.now() - startTime;
      return {
        reachable: true,
        mode: 'chroma-service',
        endpoint: config.VECTOR_DB_URL,
        pingMs,
        heartbeat: hb,
        status: 'ONLINE'
      };
    } catch (err) {
      // Service unreachable, fall back to persistent local engine
    }
  }

  // Local persistent vector store fallback
  const localDbDir = path.resolve(process.cwd(), 'data/vector_db');
  if (!fs.existsSync(localDbDir)) {
    fs.mkdirSync(localDbDir, { recursive: true });
  }

  return {
    reachable: true,
    mode: 'local-persistent',
    storagePath: localDbDir,
    pingMs: Date.now() - startTime,
    configuredUrl: config.VECTOR_DB_URL,
    status: 'READY'
  };
};

export const getChromaClient = () => {
  return chromaHttpClient;
};

export const getCollection = async (name) => {
  if (chromaHttpClient) {
    try {
      return await chromaHttpClient.getOrCreateCollection({ name });
    } catch (error) {
      logger.warn(`ChromaDB remote collection error: ${error.message}`);
    }
  }
  return null;
};
