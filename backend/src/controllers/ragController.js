import { runRagPipeline } from '../rag/pipeline.js';
import { ingestDocument } from '../rag/ingester.js';
import QueryHistory from '../models/QueryHistory.js';

export const queryRag = async (req, res, next) => {
  try {
    const { query, options } = req.body ?? {};
    if (typeof query !== 'string' || query.trim().length < 3 || query.trim().length > 2000) {
      return res.status(400).json({ error: 'Query must be between 3 and 2000 characters' });
    }

    const result = await runRagPipeline(query.trim(), options);
    
    if (req.user) {
      await QueryHistory.create({
        userId: req.user._id,
        query: query,
        answer: result.answer,
        sources: result.sources,
        retrievedChunks: result.retrievedChunks
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const reingest = async (req, res, next) => {
  try {
    const { documentId } = req.body ?? {};
    if (!documentId) return res.status(400).json({ error: 'documentId is required' });
    
    const count = await ingestDocument(documentId);
    res.json({ message: `Reingested document ${documentId}`, chunks: count });
  } catch (error) {
    next(error);
  }
};

export const listQueryHistory = async (req, res, next) => {
  try {
    const history = await QueryHistory.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-__v');
    res.json(history);
  } catch (error) {
    next(error);
  }
};
