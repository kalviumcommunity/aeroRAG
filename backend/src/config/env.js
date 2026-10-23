import fs from 'fs';
import path from 'path';

// Resilient .env loader without requiring external dotenv module
try {
  const envPath = path.resolve(process.cwd(), '.env');
  const backendEnvPath = path.resolve(process.cwd(), 'backend/.env');
  const targetEnv = fs.existsSync(envPath) ? envPath : (fs.existsSync(backendEnvPath) ? backendEnvPath : null);

  if (targetEnv) {
    const content = fs.readFileSync(targetEnv, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  // Silent fallback to system environment variables
}

const config = {
  PORT: process.env.PORT || 5000,
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/aerorag',
  JWT_SECRET: process.env.JWT_SECRET || 'fallback_secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  VECTOR_DB_URL: process.env.VECTOR_DB_URL || 'http://localhost:8000',
  VECTOR_DIMENSION: parseInt(process.env.VECTOR_DIMENSION, 10) || 768,
  COLLECTION_NAME: process.env.COLLECTION_NAME || 'aerorag_chunks',
  VECTOR_METRIC: process.env.VECTOR_METRIC || 'cosine',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEMO_MODE: process.env.DEMO_MODE === 'true' || !process.env.GOOGLE_API_KEY,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
};

export default config;
