import express from 'express';
import { listUsers, updateUserRole, deleteUser } from '../controllers/userController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/', requireAuth, requireAdmin, listUsers);
router.patch('/:id/role', requireAuth, requireAdmin, updateUserRole);
router.delete('/:id', requireAuth, requireAdmin, deleteUser);

export default router;

