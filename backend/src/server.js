import express from 'express';
import cors from 'cors';
import config from './config/env.js';
import connectDB from './config/db.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import documentRoutes from './routes/documentRoutes.js';
import ragRoutes from './routes/ragRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import logger from './utils/logger.js';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/rag', ragRoutes);
app.use('/api/health', healthRoutes);

// Error Handler
app.use(errorHandler);

const PORT = config.PORT;

const startServer = async () => {
  await connectDB();
  
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    if (config.DEMO_MODE) {
      logger.info(`[DEMO MODE] Application is running in demo mode with mock embeddings/LLM.`);
    }
  });
};

startServer();
