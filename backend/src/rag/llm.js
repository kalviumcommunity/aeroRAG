import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import {
  STRUCTURED_SYSTEM_PROMPT,
  processLlmOutput
} from './structuredOutput.js';
import {
  createLLMClient,
  getLLMClient,
  LLMClientError,
  MissingConfigurationError,
  LLMTimeoutError,
  RateLimitError,
  InvalidResponseError,
  ProviderError
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

export const GROUNDED_CONFIG = {
  temperature: 0.1,
  maxOutputTokens: 500,
  topP: 0.8,
  stopSequences: []
};

function generateMockAnswer(contextChunks, options = {}) {
  if (!contextChunks || contextChunks.length === 0) {
    if (options.structured) {
      return JSON.stringify({
        answer: "I could not find sufficient information in the available airline documents.",
        source: {
          documentId: "NONE",
          title: "No Matching Documentation",
          status: "N/A"
        },
        confidence: 0.0,
        supersededNotes: null,
        isGrounded: false
      });
    }
    return "I could not find sufficient information in the available airline documents.";
  }
  
  const sources = [...new Set(contextChunks.map(c => `${c.metadata?.documentId || c.id} - ${c.metadata?.documentTitle || c.metadata?.title || 'Procedure'} (Status: ${c.metadata?.status || 'APPROVED'})`))];
  const primaryDoc = contextChunks[0]?.metadata || {};

  if (options.structured) {
    return JSON.stringify({
      answer: `Based on verified airline documentation (${primaryDoc.documentId || 'SOP'}), the requested procedure is strictly governed by approved operating standards.`,
      source: {
        documentId: primaryDoc.documentId || 'SOP-OPS-737-04',
        title: primaryDoc.documentTitle || 'Boeing 737 Standard Operating Procedures',
        status: primaryDoc.status || 'APPROVED',
        effectiveDate: primaryDoc.effectiveDate || '2024-03-01'
      },
      confidence: 0.95,
      supersededNotes: primaryDoc.supersedes ? `Supersedes previous standard ${primaryDoc.supersedes}` : null,
      isGrounded: true
    });
  }

  let answer = `[MOCK ANSWER - DEMO MODE]
1. Direct answer: Based on the retrieved mock data, the requested procedure is covered in the following documents.
2. Authoritative documents: ${sources.join(', ')}
3. Supersession notes: Please verify the status of these documents carefully.`;

  // Apply stop sequences if specified
  if (options.stopSequences && Array.isArray(options.stopSequences)) {
    for (const seq of options.stopSequences) {
      const idx = answer.indexOf(seq);
      if (idx !== -1) {
        answer = answer.substring(0, idx);
      }
    }
  }

  // Apply max output tokens limit (simulated approx 4 chars per token)
  if (options.maxOutputTokens && answer.length > options.maxOutputTokens * 4) {
    answer = answer.substring(0, options.maxOutputTokens * 4) + '... [TRUNCATED: max_tokens limit reached]';
  }

  return answer;
}

export const generateAnswer = async (query, contextChunks, customOptions = {}) => {
  const options = {
    ...GROUNDED_CONFIG,
    ...customOptions
  };

  if (config.DEMO_MODE || !genAI) {
    const mockRaw = generateMockAnswer(contextChunks, options);
    if (options.structured) {
      return processLlmOutput(mockRaw);
    }
    return mockRaw;
  }

  // Use maintainable prompt template
  const templateBuilder = options.promptTemplate || defaultAirlinePromptTemplate;
  const { fullPrompt } = templateBuilder.buildPrompt({
    query,
    chunks: contextChunks,
    structured: Boolean(options.structured)
  });

  try {
    const generationConfig = {
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      ...(options.stopSequences && options.stopSequences.length > 0 ? { stopSequences: options.stopSequences } : {}),
      ...(options.structured ? { responseMimeType: 'application/json' } : {})
    };

    const modelName = options.model || config.LLM_MODEL || 'gemini-3.5-flash-lite';
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig
    });

    const result = await model.generateContent(fullPrompt);
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
  defaultAirlinePromptTemplate
};
