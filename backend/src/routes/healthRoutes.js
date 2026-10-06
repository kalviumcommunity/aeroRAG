import express from 'express';
import mongoose from 'mongoose';
import { getChromaClient } from '../config/chroma.js';
import config from '../config/env.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    chromadb: 'unknown',
    demoMode: config.DEMO_MODE,
    timestamp: new Date().toISOString()
  };

  try {
    const client = getChromaClient();
    await client.heartbeat();
    health.chromadb = 'connected';
  } catch (error) {
    health.chromadb = 'disconnected';
  }

  res.json(health);
});

export default router;
