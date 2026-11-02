import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import {
  STRUCTURED_SYSTEM_PROMPT,
  STRUCTURED_RAG_SCHEMA,
  APPLICABILITY_STATUSES,
  UNCERTAINTY_LEVELS,
  REFUSAL_REASONS,
  DOCUMENT_STATUSES,
  processLlmOutput,
  parseStructuredOutput,
  validateStructuredOutput
} from './structuredOutput.js';
import {
  createLLMClient,
  getLLMClient,
  LLMClientError,
  MissingConfigurationError,
  LLMTimeoutError,
  RateLimitError,
  InvalidResponseError,
  ProviderError,
  calculateCost,
  estimateTokenCount,
  estimateTokenCountSync,
  ContextBudgetManager,
  ContextBudgetExceededError,
  OversizedMessageError,
  validateModelParameters,
  ModelParameterError,
  ModelParameterValidationError,
  UnsupportedParameterError,
  DEFAULT_GROUNDED_PARAMETERS,
  PROVIDER_CAPABILITIES
} from './llmClient.js';
import {
  AirlineProcedurePromptTemplate,
  defaultAirlinePromptTemplate,
  AIRLINE_SYSTEM_INSTRUCTIONS
} from './promptTemplates.js';

let genAI;
const activeApiKey = config.GOOGLE_API_KEY || config.GEMINI_API_KEY;
if (activeApiKey && !config.DEMO_MODE) {
  genAI = new GoogleGenerativeAI(activeApiKey);
}

export const SYSTEM_PROMPT = AIRLINE_SYSTEM_INSTRUCTIONS;

export const GROUNDED_CONFIG = { ...DEFAULT_GROUNDED_PARAMETERS };

function generateMockAnswer(query, contextChunks, options = {}, conflictAnalysis = null) {
  if (!contextChunks || contextChunks.length === 0) {
    if (options.structured) {
      return JSON.stringify({
        answer: "I could not find sufficient information in the available airline documents.",
        evidenceReferences: [],
        applicabilityStatus: "NOT_APPLICABLE",
        uncertainty: {
          level: "COMPLETE",
          score: 1.0,
          reason: "No matching documentation found"
        },
        refusalReason: "INSUFFICIENT_EVIDENCE",
        // legacy compatibility
        source: null,
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
      evidenceReferences: [
        {
          documentId,
          title,
          section: primaryDoc.section || primaryDoc.sectionTitle || 'General Procedure',
          page: Number(primaryDoc.page) || 1,
          ...(primaryDoc.effectiveDate || primaryDoc.effective_date
            ? { effectiveDate: primaryDoc.effectiveDate || primaryDoc.effective_date }
            : {}),
          status: (primaryDoc.status || 'UNKNOWN').toUpperCase(),
          quote: passage ? passage.substring(0, 150) : null
        }
      ],
      applicabilityStatus: primaryDoc.status === 'SUPERSEDED' ? 'SUPERSEDED' : 'APPLICABLE',
      uncertainty: {
        level: "LOW",
        score: 0.05,
        reason: "Direct statement in current approved SOP"
      },
      refusalReason: null,
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
  // Validate model parameters
  const paramValidation = validateModelParameters(customOptions, 'gemini', {
    strict: Boolean(customOptions.strict)
  });
  const options = {
    ...GROUNDED_CONFIG,
    ...paramValidation.parameters,
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

  // Use maintainable prompt template
  const templateBuilder = options.promptTemplate || defaultAirlinePromptTemplate;
  const { fullPrompt } = templateBuilder.buildPrompt({
    query,
    chunks: contextChunks,
    structured: Boolean(options.structured)
  });
  const prompt = conflictPrompt ? `${fullPrompt}\n\n${conflictPrompt}` : fullPrompt;

  try {
    const generationConfig = {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      ...(options.topK ? { topK: options.topK } : {}),
      ...(options.stopSequences && options.stopSequences.length > 0 ? { stopSequences: options.stopSequences } : {}),
      ...(options.structured ? { responseMimeType: 'application/json' } : {})
    };

    const modelName = options.model || config.LLM_MODEL || 'gemini-3.5-flash-lite';
    const model = genAI.getGenerativeModel({
      model: modelName,
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

export {
  createLLMClient,
  getLLMClient,
  LLMClientError,
  MissingConfigurationError,
  LLMTimeoutError,
  RateLimitError,
  InvalidResponseError,
  ProviderError,
  AirlineProcedurePromptTemplate,
  defaultAirlinePromptTemplate,
  calculateCost,
  estimateTokenCount,
  estimateTokenCountSync,
  ContextBudgetManager,
  ContextBudgetExceededError,
  OversizedMessageError,
  validateModelParameters,
  ModelParameterError,
  ModelParameterValidationError,
  UnsupportedParameterError,
  DEFAULT_GROUNDED_PARAMETERS,
  PROVIDER_CAPABILITIES,
  STRUCTURED_SYSTEM_PROMPT,
  STRUCTURED_RAG_SCHEMA,
  APPLICABILITY_STATUSES,
  UNCERTAINTY_LEVELS,
  REFUSAL_REASONS,
  DOCUMENT_STATUSES,
  processLlmOutput,
  parseStructuredOutput,
  validateStructuredOutput
};
