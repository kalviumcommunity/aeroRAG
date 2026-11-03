import express from 'express';
import mongoose from 'mongoose';
import { getChromaClient } from '../config/chroma.js';
import config from '../config/env.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    backend: 'connected',
    server: 'aeroRAG Express Flight Intelligence Backend',
    version: '2.4.0',
    port: config.PORT,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected (in-memory demo)',
    chromadb: 'connected (in-memory mock / local)',
    vectorDimension: config.VECTOR_DIMENSION || 768,
    llmModel: config.LLM_MODEL,
    demoMode: config.DEMO_MODE,
    timestamp: new Date().toISOString()
  };

  try {
    const client = getChromaClient();
    await client.heartbeat();
    health.chromadb = 'connected';
  } catch (error) {
    // Keep in-memory mock note
  }

  res.json(health);
});

export default router;
