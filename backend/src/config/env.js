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
  VECTOR_DB_URL: process.env.VECTOR_DB_URL || 'http://localhost:8000',
  VECTOR_DIMENSION: parseInt(process.env.VECTOR_DIMENSION, 10) || 768,
  COLLECTION_NAME: process.env.COLLECTION_NAME || 'aerorag_chunks',
  VECTOR_METRIC: process.env.VECTOR_METRIC || 'cosine',
  VECTOR_STORE_PATH: process.env.VECTOR_STORE_PATH,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEMO_MODE: process.env.DEMO_MODE === 'true' || !process.env.GOOGLE_API_KEY,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
};

if (config.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('Production requires a JWT_SECRET of at least 32 characters');
}

export default config;
