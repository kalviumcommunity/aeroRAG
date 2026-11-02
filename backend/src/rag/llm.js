import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import {
  STRUCTURED_SYSTEM_PROMPT,
  processLlmOutput
} from './structuredOutput.js';

let genAI;
if (config.GOOGLE_API_KEY && !config.DEMO_MODE) {
  genAI = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
}

const SYSTEM_PROMPT = `
You are AeroRAG, an AI-powered airline procedure verification assistant for flight operations and ground staff.

Aviation Safety Directives:
1. Answer ONLY using the provided retrieved airline documents.
2. Never invent procedures, regulations, altitudes, airspeeds, fuel reserves, or dates.
3. If the retrieved documents do not contain enough information, clearly state:
   "I could not find sufficient information in the available airline documents."
4. DOCUMENT VERSION & CONFLICT PROTOCOL:
   - Prefer the latest valid document according to status, effective date, and supersession metadata.
   - If an older document has been superseded, EXPLICITLY state that it is superseded and must NOT be used.
   - Clearly cite the authoritative document (Document ID, Version, Section, and Page if available).
   - If an expired or draft document is present, highlight the validity risk clearly.

Format your response clearly:
1. Direct Procedure Answer
2. Authoritative Source Citation (Doc ID, Version, Section, Page)
3. Supersession / Conflict Notes (if applicable)
`;

export const GROUNDED_CONFIG = {
  temperature: 0.1,
  maxOutputTokens: 600,
  topP: 0.8,
  stopSequences: []
};

function generateMockAnswer(query, contextChunks, options = {}, conflictAnalysis = null) {
  if (!contextChunks || contextChunks.length === 0) {
    if (options.structured) {
      return JSON.stringify({
        answer: "I could not find sufficient information in the available airline documents.",
        source: {
          documentId: "NONE",
          title: "No Matching Documentation",
          status: "UNKNOWN"
        },
        confidence: 0.0,
        supersededNotes: null,
        isGrounded: false
      });
    }
    return "I could not find sufficient information in the available airline documents.";
  }

  // Find authoritative chunk: prefer CURRENT over others
  const currentChunk = contextChunks.find(c => {
    const s = (c.metadata?.status || '').toUpperCase();
    return s === 'CURRENT' || s === 'APPROVED' || s === 'ACTIVE';
  }) || contextChunks[0];

  const primaryDoc = currentChunk.metadata || {};
  const documentId = primaryDoc.documentId || primaryDoc.source || 'UNKNOWN';
  const title = primaryDoc.documentTitle || primaryDoc.document_title || primaryDoc.title || 'Unknown source';
  const version = primaryDoc.version || '1.0';
  const section = primaryDoc.section || 'General Procedure';
  const page = primaryDoc.page ? ` (Page ${primaryDoc.page})` : '';
  const passage = currentChunk.document;

  let answerText = `[DEMO MODE — EXTRACTIVE ONLY]\n\n`;

  if (conflictAnalysis?.hasConflict) {
    answerText += `⚠️ [PROCEDURAL CONFLICT WARNING]\n${conflictAnalysis.warningMessage}\n\n`;
    answerText += `RECOMMENDATION: ${conflictAnalysis.recommendation}\n\n`;
    answerText += `--- AUTHORITATIVE PROCEDURE ---\nSource: ${title} (${documentId} v${version}) - Section: ${section}${page}\n\n${passage}\n`;
  } else {
    answerText += `Authoritative Source: ${title} (${documentId} v${version}) - Section: ${section}${page}\n\n${passage}\n`;
  }

  answerText += `\nVerification Note: This procedure was extracted from airline documentation. Always cross-check operational limits prior to flight dispatch or ground execution.`;

  if (options.structured) {
    return JSON.stringify({
      answer: answerText,
      source: {
        documentId,
        title,
        status: primaryDoc.status || 'CURRENT',
        ...(primaryDoc.effectiveDate || primaryDoc.effective_date
          ? { effectiveDate: primaryDoc.effectiveDate || primaryDoc.effective_date }
          : {})
      },
      confidence: conflictAnalysis?.hasConflict ? 0.95 : 0.85,
      supersededNotes: conflictAnalysis?.warningMessage || null,
      isGrounded: true
    });
  }

  let mockAnswer = answerText;

  // Apply stop sequences if specified
  if (options.stopSequences && Array.isArray(options.stopSequences)) {
    for (const seq of options.stopSequences) {
      const idx = mockAnswer.indexOf(seq);
      if (idx !== -1) {
        mockAnswer = mockAnswer.substring(0, idx);
      }
    }
  }

  // Apply max output tokens limit (simulated approx 4 chars per token)
  if (options.maxOutputTokens && mockAnswer.length > options.maxOutputTokens * 4) {
    mockAnswer = mockAnswer.substring(0, options.maxOutputTokens * 4) + '... [TRUNCATED: max_tokens limit reached]';
  }

  return mockAnswer;
}

export const generateAnswer = async (query, contextChunks, customOptions = {}) => {
  const options = {
    ...GROUNDED_CONFIG,
    ...customOptions
  };

  const conflictAnalysis = options.conflictAnalysis || null;

  if (config.DEMO_MODE || !genAI) {
    const mockRaw = generateMockAnswer(query, contextChunks, options, conflictAnalysis);
    if (options.structured) {
      return processLlmOutput(mockRaw);
    }
    return mockRaw;
  }

  const contextString = contextChunks.map((c, i) => `
--- Source ${i + 1} ---
Document ID: ${c.metadata.documentId}
Title: ${c.metadata.documentTitle || c.metadata.title}
Status: ${c.metadata.status}
Version: ${c.metadata.version || 'N/A'}
Section: ${c.metadata.section || 'General'}
Page: ${c.metadata.page || 'N/A'}
Effective Date: ${c.metadata.effectiveDate || 'N/A'}
Supersedes: ${c.metadata.supersedes || 'None'}
Passage Content:
${c.document}
`).join('\n');

  let conflictPrompt = '';
  if (conflictAnalysis && conflictAnalysis.hasConflict) {
    conflictPrompt = `
ATTENTION - PROCEDURE CONFLICT / SUPERSEDED VERSION DETECTED:
- Conflict Type: ${conflictAnalysis.conflictType}
- Warning: ${conflictAnalysis.warningMessage}
- Recommendation: ${conflictAnalysis.recommendation}
- Authoritative Document ID: ${conflictAnalysis.authoritativeDocument?.documentId || 'CURRENT'}
CRITICAL: You MUST prioritize the authoritative document procedure. Warn the user clearly not to follow superseded or expired procedures.
`;
  }

  const selectedPrompt = options.structured ? STRUCTURED_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const prompt = `
${selectedPrompt}

${conflictPrompt}

User Query: ${query}

Retrieved Documents:
${contextString}
`;

  try {
    const generationConfig = {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      ...(options.stopSequences && options.stopSequences.length > 0 ? { stopSequences: options.stopSequences } : {}),
      ...(options.structured ? { responseMimeType: 'application/json' } : {})
    };

    const model = genAI.getGenerativeModel({
      model: config.LLM_MODEL,
      generationConfig
    });

    const result = await model.generateContent(prompt);
    const rawText = result.response.text();

    if (options.structured) {
      return processLlmOutput(rawText);
    }

    return rawText;
  } catch (error) {
    logger.error(`Error generating LLM answer: ${error.message}`);
    throw error;
  }
};

export const generateStructuredAnswer = async (query, contextChunks, customOptions = {}) => {
  return generateAnswer(query, contextChunks, { ...customOptions, structured: true });
};
