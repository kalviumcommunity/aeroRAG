import express from 'express';
import { queryRag, reingest, listQueryHistory } from '../controllers/ragController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// We can allow unauthenticated queries if needed, but per requirements "all authenticated" can read. Let's make it requireAuth.
router.post('/query', requireAuth, queryRag);
router.get('/history', requireAuth, listQueryHistory);
router.post('/ingest', requireAuth, requireAdmin, reingest);

export default router;
