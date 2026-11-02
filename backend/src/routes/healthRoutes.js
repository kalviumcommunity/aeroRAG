import express from 'express';
import mongoose from 'mongoose';
import { getChromaClient } from '../config/chroma.js';
import config from '../config/env.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const chromaClient = getChromaClient();
  const health = {
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    chromadb: chromaClient ? 'unknown' : 'local-fallback',
    vectorStore: 'local-persistent',
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

  if (health.mongodb !== 'connected') health.status = 'degraded';
  res.json(health);
});

router.get('/live', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

router.get('/ready', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    mongodb: ready ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

export default router;
