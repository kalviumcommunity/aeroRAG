import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryRoot = path.resolve(backendRoot, '..');
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.join(backendRoot, '.env'),
  path.join(repositoryRoot, '.env')
];
const envPath = envPaths.find(candidate => fs.existsSync(candidate));

if (envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const separator = trimmed.indexOf('=');
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const config = {
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/aerorag',
  JWT_SECRET: process.env.JWT_SECRET || 'fallback_secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'google',
  LLM_MODEL: process.env.LLM_MODEL || 'gemini-1.5-flash',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'text-embedding-004',
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  LLM_PROVIDER: process.env.LLM_PROVIDER || 'gemini',
  LLM_MODEL: process.env.LLM_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  LLM_TIMEOUT_MS: parseInt(process.env.LLM_TIMEOUT_MS, 10) || 30000,
  LLM_TEMPERATURE: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0.1,
  LLM_MAX_TOKENS: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS, 10) : 500,
  LLM_TOP_P: process.env.LLM_TOP_P ? parseFloat(process.env.LLM_TOP_P) : 0.8,
  MAX_CONTEXT_TOKENS: parseInt(process.env.MAX_CONTEXT_TOKENS, 10) || 8192,
  EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'gemini',
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'text-embedding-004',
  EMBEDDING_DIMENSION: parseInt(process.env.EMBEDDING_DIMENSION, 10) || 768,
  EMBEDDING_BATCH_SIZE: parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 32,
  EMBEDDING_TIMEOUT_MS: parseInt(process.env.EMBEDDING_TIMEOUT_MS, 10) || 30000,
  LLM_INPUT_COST_PER_M: process.env.LLM_INPUT_COST_PER_M ? parseFloat(process.env.LLM_INPUT_COST_PER_M) : null,
  LLM_OUTPUT_COST_PER_M: process.env.LLM_OUTPUT_COST_PER_M ? parseFloat(process.env.LLM_OUTPUT_COST_PER_M) : null,
  VECTOR_DB_URL: process.env.VECTOR_DB_URL || 'http://localhost:8000',
  VECTOR_DIMENSION: parseInt(process.env.VECTOR_DIMENSION, 10) || 768,
  COLLECTION_NAME: process.env.COLLECTION_NAME || 'aerorag_chunks',
  VECTOR_METRIC: process.env.VECTOR_METRIC || 'cosine',
  VECTOR_STORE_PATH: process.env.VECTOR_STORE_PATH,
  VECTOR_ENGINE: process.env.VECTOR_ENGINE || 'qdrant',
  QDRANT_URL: process.env.QDRANT_URL || process.env.VECTOR_DB_URL || 'http://localhost:6333',
  QDRANT_API_KEY: process.env.QDRANT_API_KEY || null,
  QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || process.env.COLLECTION_NAME || 'aerorag_chunks',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEMO_MODE: process.env.DEMO_MODE === 'true' || !(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
};

if (config.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Production requires a JWT_SECRET of at least 32 characters');
}

export default config;
