import express from 'express';
import {
  listDocuments,
  getDocumentStats,
  compareDocuments,
  getDocument,
  getDocumentContent,
  uploadDocument,
  updateDocument,
  reindexDocument,
  deleteDoc
} from '../controllers/documentController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

router.get('/', requireAuth, listDocuments);
router.get('/stats', requireAuth, getDocumentStats);
router.get('/compare/:id1/:id2', requireAuth, compareDocuments);
router.get('/:id', requireAuth, getDocument);
router.get('/:id/content', requireAuth, getDocumentContent);

router.post('/upload', requireAuth, requireAdmin, upload.single('file'), uploadDocument);
router.post('/:id/reindex', requireAuth, requireAdmin, reindexDocument);
router.put('/:id', requireAuth, requireAdmin, updateDocument);
router.delete('/:id', requireAuth, requireAdmin, deleteDoc);

export default router;
