import express from 'express';
import { listDocuments, getDocument, uploadDocument, updateDocument, deleteDoc } from '../controllers/documentController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';

const router = express.Router();

router.get('/', requireAuth, listDocuments);
router.get('/:id', requireAuth, getDocument);
router.post('/upload', requireAuth, requireAdmin, upload.single('file'), uploadDocument);
router.put('/:id', requireAuth, requireAdmin, updateDocument);
router.delete('/:id', requireAuth, requireAdmin, deleteDoc);

export default router;
