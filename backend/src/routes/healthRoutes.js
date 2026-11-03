import express from 'express';
import mongoose from 'mongoose';
import { getChromaClient } from '../config/chroma.js';
import config from '../config/env.js';

const router = express.Router();

router.get('/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

router.get('/ready', (req, res) => {
  const isMongoConnected = mongoose.connection.readyState === 1;
  if (!isMongoConnected) {
    return res.status(503).json({ status: 'not_ready', mongodb: 'disconnected' });
  }
  return res.status(200).json({ status: 'ready', mongodb: 'connected' });
});

router.get('/', async (req, res) => {
  const chromaClient = getChromaClient();
  const isMongoConnected = mongoose.connection.readyState === 1;

  const health = {
    status: isMongoConnected ? 'ok' : 'degraded',
    backend: 'connected',
    server: 'aeroRAG Express Flight Intelligence Backend',
    version: '2.4.0',
    port: config.PORT,
    mongodb: isMongoConnected ? 'connected' : 'disconnected (in-memory demo)',
    chromadb: chromaClient ? 'connected' : 'local-fallback',
    vectorStore: config.DEMO_MODE ? 'local-mock' : 'chromadb',
    vectorDimension: config.VECTOR_DIMENSION || 768,
    llmModel: config.LLM_MODEL,
    demoMode: config.DEMO_MODE,
    timestamp: new Date().toISOString()
  };

  if (chromaClient) {
    try {
      await chromaClient.heartbeat();
      health.chromadb = 'connected';
      if (!config.DEMO_MODE) health.vectorStore = 'chromadb';
    } catch (error) {
      health.chromadb = 'disconnected';
    }
  }

  res.json(health);
});

export default router;
