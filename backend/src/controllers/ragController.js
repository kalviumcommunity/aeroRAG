import { runRagPipeline } from '../rag/pipeline.js';
import { ingestDocument } from '../rag/ingester.js';
import QueryHistory from '../models/QueryHistory.js';

export const queryRag = async (req, res, next) => {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    const result = await runRagPipeline(query);
    
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
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: 'documentId is required' });
    
    const count = await ingestDocument(documentId);
    res.json({ message: `Reingested document ${documentId}`, chunks: count });
  } catch (error) {
    next(error);
  }
};
