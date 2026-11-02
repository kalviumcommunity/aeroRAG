import { retrieve } from './retriever.js';
import { generateAnswer } from './llm.js';
import { detectConflicts } from './conflictDetector.js';
import config from '../config/env.js';

export const runRagPipeline = async (query, options = {}) => {
  // 1 & 2. Embed and Retrieve
  const retrievedChunks = await retrieve(query, 5);

  // 3. Detect procedural conflicts and supersession
  const conflictAnalysis = detectConflicts(retrievedChunks, query);

  // 4. Call LLM with generation parameters and conflict context
  const llmResponse = await generateAnswer(query, retrievedChunks, {
    ...options,
    conflictAnalysis
  });

  // Check if response is structured object or plain string
  const isStructured = typeof llmResponse === 'object' && llmResponse !== null;
  const structuredData = isStructured ? llmResponse : null;
  const answerText = isStructured
    ? (llmResponse.data?.answer || 'Failed to generate valid structured response')
    : llmResponse;

  // 5. Build unique sources array
  const sourcesMap = new Map();
  retrievedChunks.forEach(chunk => {
    const m = chunk.metadata || {};
    const documentId = m.documentId ?? m.source;
    if (documentId && !sourcesMap.has(documentId)) {
      sourcesMap.set(documentId, {
        documentId,
        title: m.documentTitle ?? m.document_title ?? m.title ?? 'Untitled source',
        version: m.version ?? null,
        effectiveDate: m.effectiveDate ?? m.effective_date ?? null,
        expiryDate: m.expiryDate ?? m.expiry_date ?? null,
        status: m.status ?? 'UNKNOWN',
        documentType: m.documentType ?? null
      });
    }
  });

  const resolvedSources = Array.from(sourcesMap.values());

  // 6. Detailed citations with page and section
  const citations = retrievedChunks.map(chunk => {
    const metadata = chunk.metadata || {};
    return {
      documentId: metadata.documentId ?? metadata.source ?? null,
      title: metadata.documentTitle ?? metadata.document_title ?? metadata.title ?? 'Untitled source',
      status: metadata.status ?? 'UNKNOWN',
      version: metadata.version ?? null,
      effectiveDate: metadata.effectiveDate ?? metadata.effective_date ?? null,
      expiryDate: metadata.expiryDate ?? metadata.expiry_date ?? null,
      section: metadata.section ?? null,
      page: metadata.page ?? null,
      passage: chunk.document
    };
  });

  return {
    answer: answerText,
    structured: structuredData,
    sources: resolvedSources,
    citations,
    retrievedChunks: retrievedChunks.length,
    conflictAnalysis,
    confidence: structuredData?.data?.confidence ?? (retrievedChunks.length > 0 ? 0.9 : 0),
    isGrounded: retrievedChunks.length > 0 && (structuredData?.data?.isGrounded ?? true),
    demoMode: config.DEMO_MODE,
    generationOptions: options
  };
};
