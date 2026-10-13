import { retrieve } from './retriever.js';
import { generateAnswer } from './llm.js';
import config from '../config/env.js';

export const runRagPipeline = async (query, options = {}) => {
  // 1 & 2. Embed and Retrieve
  const retrievedChunks = await retrieve(query, 5);

  // 3 & 4. Call LLM with generation parameters
  const llmResponse = await generateAnswer(query, retrievedChunks, options);

  // Check if response is structured object or plain string
  const isStructured = typeof llmResponse === 'object' && llmResponse !== null;
  const structuredData = isStructured ? llmResponse : null;
  const answerText = isStructured
    ? (llmResponse.data?.answer || 'Failed to generate valid structured response')
    : llmResponse;

  // 5. Build sources array
  const sourcesMap = new Map();
  retrievedChunks.forEach(chunk => {
    const m = chunk.metadata;
    if (!sourcesMap.has(m.documentId)) {
      sourcesMap.set(m.documentId, {
        documentId: m.documentId,
        title: m.documentTitle,
        effectiveDate: m.effectiveDate,
        status: m.status
      });
    }
  });

  const resolvedSources = (structuredData?.data?.source)
    ? [structuredData.data.source]
    : Array.from(sourcesMap.values());

  return {
    answer: answerText,
    structured: structuredData,
    sources: resolvedSources,
    retrievedChunks: retrievedChunks.length,
    confidence: structuredData?.data?.confidence ?? 0.9,
    isGrounded: structuredData?.data?.isGrounded ?? true,
    demoMode: config.DEMO_MODE,
    generationOptions: options
  };
};
