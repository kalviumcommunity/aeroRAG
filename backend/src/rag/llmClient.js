import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import {
  calculateCost,
  estimateTokenCount,
  estimateTokenCountSync,
  ContextBudgetManager,
  ContextBudgetExceededError,
  OversizedMessageError
} from './tokenContextManager.js';
import {
  validateModelParameters,
  ModelParameterError,
  ModelParameterValidationError,
  UnsupportedParameterError,
  DEFAULT_GROUNDED_PARAMETERS,
  PROVIDER_CAPABILITIES
} from './modelParameters.js';

// ============================================================================
// Error Hierarchy
// ============================================================================

export class LLMClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category || 'GENERAL_ERROR';
    this.statusCode = options.statusCode || 500;
    this.retryable = Boolean(options.retryable);
    this.details = options.details || null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class MissingConfigurationError extends LLMClientError {
  constructor(message = 'Missing LLM configuration or credentials', options = {}) {
    super(message, {
      category: 'MISSING_CONFIGURATION',
      statusCode: 400,
      retryable: false,
      details: options.details || {
        requiredEnvVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
        help: 'Provide a valid Google Gemini API key via GOOGLE_API_KEY or GEMINI_API_KEY environment variable.'
      },
      ...options
    });
  }
}

export class LLMTimeoutError extends LLMClientError {
  constructor(message = 'LLM request timed out', options = {}) {
    super(message, {
      category: 'TIMEOUT',
      statusCode: 504,
      retryable: true,
      details: { timeoutMs: options.timeoutMs },
      ...options
    });
    this.timeoutMs = options.timeoutMs;
  }
}

export class RateLimitError extends LLMClientError {
  constructor(message = 'LLM provider rate limit or quota exceeded', options = {}) {
    super(message, {
      category: 'RATE_LIMIT',
      statusCode: 429,
      retryable: true,
      details: {
        retryAfterMs: options.retryAfterMs || 5000,
        provider: options.provider || 'gemini',
        ...options.details
      },
      ...options
    });
    this.retryAfterMs = options.retryAfterMs || 5000;
  }
}

export class InvalidResponseError extends LLMClientError {
  constructor(message = 'Invalid or empty response received from LLM provider', options = {}) {
    super(message, {
      category: 'INVALID_RESPONSE',
      statusCode: 502,
      retryable: false,
      details: options.details || null,
      ...options
    });
  }
}

export class ProviderError extends LLMClientError {
  constructor(message = 'LLM provider upstream error', options = {}) {
    super(message, {
      category: 'PROVIDER_ERROR',
      statusCode: options.statusCode || 502,
      retryable: options.statusCode ? options.statusCode >= 500 : true,
      details: options.details || null,
      ...options
    });
  }
}

// ============================================================================
// Base Adapter Interface
// ============================================================================

export class BaseLLMAdapter {
  constructor(options = {}) {
    this.provider = options.provider || 'base';
    this.model = options.model || 'default';
  }

  /**
   * Send a message/prompt to the model and return a normalized completion response.
   * @param {string|Array<{role: string, content: string}>} promptOrMessages 
   * @param {object} [options]
   * @returns {Promise<{text: string, model: string, provider: string, usage: object, cost: object, finishReason: string, latencyMs: number, metadata: object, raw: any}>}
   */
  async sendMessage(promptOrMessages, options = {}) {
    throw new Error('sendMessage() must be implemented by adapter subclasses');
  }

  /**
   * Helper to normalize input into a single prompt string if needed.
   */
  _normalizePrompt(promptOrMessages) {
    if (typeof promptOrMessages === 'string') {
      return promptOrMessages;
    }
    if (Array.isArray(promptOrMessages)) {
      return promptOrMessages
        .map(m => {
          const role = (m.role || 'user').toUpperCase();
          const content = m.content || '';
          return `${role}: ${content}`;
        })
        .join('\n\n');
    }
    return String(promptOrMessages || '');
  }
}

// ============================================================================
// Google Gemini Adapter
// ============================================================================

export class GeminiAdapter extends BaseLLMAdapter {
  constructor(options = {}) {
    super({ provider: 'gemini', ...options });
    this.apiKey = options.apiKey !== undefined
      ? options.apiKey
      : (config.GOOGLE_API_KEY || config.GEMINI_API_KEY || null);
    this.model = options.model !== undefined
      ? options.model
      : (config.LLM_MODEL || 'gemini-3.5-flash-lite');
    this.timeoutMs = options.timeoutMs ?? config.LLM_TIMEOUT_MS ?? 30000;
    this.defaultTemperature = options.temperature ?? config.LLM_TEMPERATURE ?? 0.1;
    this.defaultMaxTokens = options.maxOutputTokens ?? config.LLM_MAX_TOKENS ?? 500;
    this.defaultTopP = options.topP ?? config.LLM_TOP_P ?? 0.8;

    this.genAI = null;
    if (this.apiKey) {
      this.genAI = new GoogleGenerativeAI(this.apiKey);
    }
  }

  /**
   * Validate configuration before execution.
   */
  validateConfig() {
    if (!this.apiKey || typeof this.apiKey !== 'string' || this.apiKey.trim().length === 0) {
      throw new MissingConfigurationError(
        'Google Gemini API key is missing. Set GOOGLE_API_KEY or GEMINI_API_KEY in environment or .env file.'
      );
    }
    if (!this.model || typeof this.model !== 'string' || this.model.trim().length === 0) {
      throw new MissingConfigurationError(
        'LLM model is not configured. Set LLM_MODEL or GEMINI_MODEL in environment or .env file.'
      );
    }
  }

  /**
   * Sends a message to the Gemini chat model with parameter validation, timeout, rate limit, and error handling.
   */
  async sendMessage(promptOrMessages, callOptions = {}) {
    this.validateConfig();

    const promptText = this._normalizePrompt(promptOrMessages);
    if (!promptText || promptText.trim().length === 0) {
      throw new InvalidResponseError('Prompt cannot be empty');
    }

    const modelName = callOptions.model || this.model;
    const timeoutMs = callOptions.timeoutMs ?? this.timeoutMs;

    // Milestone 3.16: Validate model parameters & handle unsupported parameters explicitly
    const paramValidation = validateModelParameters(callOptions, 'gemini', {
      strict: Boolean(callOptions.strict)
    });

    const validated = paramValidation.parameters;
    const generationConfig = {
      temperature: validated.temperature,
      maxOutputTokens: validated.maxOutputTokens,
      topP: validated.topP,
      ...(validated.topK ? { topK: validated.topK } : {}),
      ...(validated.stopSequences && validated.stopSequences.length > 0 ? { stopSequences: validated.stopSequences } : {}),
      ...(validated.responseMimeType ? { responseMimeType: validated.responseMimeType } : {})
    };

    const startTime = Date.now();

    // Setup timeout race with timer
    let timerId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        reject(new LLMTimeoutError(
          `LLM request to Gemini model '${modelName}' timed out after ${timeoutMs}ms`,
          { timeoutMs }
        ));
      }, timeoutMs);
    });

    try {
      const modelInstance = this.genAI.getGenerativeModel({
        model: modelName,
        generationConfig
      });

      // Race between SDK call and timeout
      const result = await Promise.race([
        modelInstance.generateContent(promptText),
        timeoutPromise
      ]);

      const latencyMs = Date.now() - startTime;

      // Validate provider response
      if (!result || !result.response) {
        throw new InvalidResponseError('Gemini API returned an empty or malformed result object', {
          details: { result }
        });
      }

      const response = result.response;
      const candidates = response.candidates || [];

      // Check candidate safety / blocks
      if (candidates.length === 0) {
        const promptFeedback = response.promptFeedback;
        if (promptFeedback && promptFeedback.blockReason) {
          throw new InvalidResponseError(
            `LLM generation blocked by safety filters: ${promptFeedback.blockReason}`,
            { details: { promptFeedback } }
          );
        }
        throw new InvalidResponseError('Gemini API returned zero candidate completions', {
          details: { response }
        });
      }

      const firstCandidate = candidates[0];
      const finishReason = firstCandidate.finishReason || 'STOP';

      if (finishReason === 'SAFETY') {
        throw new InvalidResponseError('LLM response candidate was blocked by safety filters', {
          details: { safetyRatings: firstCandidate.safetyRatings, finishReason }
        });
      }

      let responseText = '';
      try {
        responseText = response.text();
      } catch (err) {
        throw new InvalidResponseError(`Failed to extract text from candidate: ${err.message}`, {
          details: { originalError: err.message, candidate: firstCandidate }
        });
      }

      if (typeof responseText !== 'string') {
        throw new InvalidResponseError('Candidate text response was not a valid string', {
          details: { responseText }
        });
      }

      // Token usage metadata if provided by Gemini API
      const usageMetadata = response.usageMetadata || {};
      const usage = {
        promptTokens: usageMetadata.promptTokenCount || Math.ceil(promptText.length / 4),
        completionTokens: usageMetadata.candidatesTokenCount || Math.ceil(responseText.length / 4),
        totalTokens: usageMetadata.totalTokenCount || Math.ceil((promptText.length + responseText.length) / 4)
      };

      // Milestone 3.14: Cost calculation when pricing is configured
      const cost = calculateCost(usage, modelName);

      return {
        text: responseText,
        model: modelName,
        provider: 'gemini',
        usage,
        cost,
        finishReason,
        latencyMs,
        metadata: {
          temperature: validated.temperature,
          maxOutputTokens: validated.maxOutputTokens,
          topP: validated.topP,
          topK: validated.topK,
          stopSequences: validated.stopSequences,
          parameterWarnings: paramValidation.warnings,
          unsupportedParameters: paramValidation.unsupportedParameters
        },
        raw: result
      };
    } catch (error) {
      if (error instanceof LLMClientError || error instanceof ModelParameterError) {
        throw error;
      }

      // Categorize upstream provider errors
      const errorMsg = error.message || String(error);
      const isRateLimit =
        errorMsg.includes('429') ||
        errorMsg.includes('RESOURCE_EXHAUSTED') ||
        errorMsg.toLowerCase().includes('quota') ||
        errorMsg.toLowerCase().includes('rate limit');

      if (isRateLimit) {
        throw new RateLimitError(`Gemini API rate limit exceeded: ${errorMsg}`, {
          details: { originalError: errorMsg }
        });
      }

      const isInvalidKey =
        errorMsg.includes('API_KEY_INVALID') ||
        errorMsg.includes('403') ||
        errorMsg.toLowerCase().includes('api key not valid');

      if (isInvalidKey) {
        throw new MissingConfigurationError(
          `Invalid Gemini API key supplied: ${errorMsg}`,
          { details: { originalError: errorMsg } }
        );
      }

      const is5xx =
        errorMsg.includes('500') ||
        errorMsg.includes('503') ||
        errorMsg.includes('Internal Server Error') ||
        errorMsg.includes('Service Unavailable');

      throw new ProviderError(`Gemini API call failed: ${errorMsg}`, {
        statusCode: is5xx ? 503 : 502,
        details: { originalError: errorMsg }
      });
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  }
}

// ============================================================================
// Mock LLM Adapter (For Automated Tests & Offline Usage)
// ============================================================================

export class MockLLMAdapter extends BaseLLMAdapter {
  constructor(options = {}) {
    super({ provider: 'mock', ...options });
    this.model = options.model || 'mock-airline-procedure-model';
    this.cannedResponse = options.cannedResponse || null;
    this.mockResponses = Array.isArray(options.mockResponses) ? [...options.mockResponses] : null;
    this.simulatedLatencyMs = options.simulatedLatencyMs ?? 5;
    this.simulateTimeout = Boolean(options.simulateTimeout);
    this.simulateRateLimit = Boolean(options.simulateRateLimit);
    this.simulateInvalidResponse = Boolean(options.simulateInvalidResponse);
    this.simulateMissingConfig = Boolean(options.simulateMissingConfig);
    this.simulateProviderError = options.simulateProviderError || false;
    this.targetProvider = options.targetProvider || null;
    
    // Call telemetry
    this.callCount = 0;
    this.history = [];
  }

  /**
   * Reset call history and counts
   */
  resetHistory() {
    this.callCount = 0;
    this.history = [];
  }

  /**
   * Mock implementation of sendMessage
   */
  async sendMessage(promptOrMessages, callOptions = {}) {
    const promptText = this._normalizePrompt(promptOrMessages);
    this.callCount++;

    const callRecord = {
      callIndex: this.callCount,
      prompt: promptText,
      options: callOptions,
      timestamp: new Date().toISOString()
    };
    this.history.push(callRecord);

    // 1. Simulate Missing Configuration
    if (this.simulateMissingConfig || callOptions.simulateMissingConfig) {
      throw new MissingConfigurationError('Mock simulated missing configuration error');
    }

    // 2. Validate model parameters & check provider incompatibilities
    const targetProvider = callOptions.validateProvider || this.targetProvider || 'mock';
    const paramValidation = validateModelParameters(callOptions, targetProvider, {
      strict: Boolean(callOptions.strict)
    });

    // 3. Simulate Timeout
    if (this.simulateTimeout || callOptions.simulateTimeout) {
      const timeout = callOptions.timeoutMs || 100;
      await new Promise(r => setTimeout(r, Math.min(timeout, 30)));
      throw new LLMTimeoutError(
        `Mock request to model '${this.model}' timed out after ${timeout}ms`,
        { timeoutMs: timeout }
      );
    }

    // 4. Simulate Rate Limit (429)
    if (this.simulateRateLimit || callOptions.simulateRateLimit) {
      throw new RateLimitError('Mock rate limit exceeded (429 Quota Exceeded)', {
        retryAfterMs: 3000
      });
    }

    // 5. Simulate Invalid Response
    if (this.simulateInvalidResponse || callOptions.simulateInvalidResponse) {
      throw new InvalidResponseError('Mock provider returned invalid response candidate structure', {
        details: { candidates: [] }
      });
    }

    // 6. Simulate Provider Error (500 / 503)
    if (this.simulateProviderError || callOptions.simulateProviderError) {
      const errSpec = callOptions.simulateProviderError || this.simulateProviderError;
      const message = typeof errSpec === 'object' && errSpec.message ? errSpec.message : 'Mock upstream service failure';
      const statusCode = typeof errSpec === 'object' && errSpec.statusCode ? errSpec.statusCode : 503;
      throw new ProviderError(message, { statusCode });
    }

    // Simulate latency
    if (this.simulatedLatencyMs > 0) {
      await new Promise(r => setTimeout(r, this.simulatedLatencyMs));
    }

    // Determine completion text
    let text = '';
    const isStructured = callOptions.structured || callOptions.responseMimeType === 'application/json';

    if (this.mockResponses && this.mockResponses.length > 0) {
      text = this.mockResponses.shift();
    } else if (typeof this.cannedResponse === 'function') {
      text = this.cannedResponse(promptText, callOptions);
    } else if (typeof this.cannedResponse === 'string') {
      text = this.cannedResponse;
    } else if (isStructured) {
      if (callOptions.simulateRefusal) {
        text = JSON.stringify({
          answer: "I could not find sufficient information in the available airline documents.",
          evidenceReferences: [],
          applicabilityStatus: "NOT_APPLICABLE",
          uncertainty: {
            level: "COMPLETE",
            score: 1.0,
            reason: "No matching documentation found"
          },
          refusalReason: "INSUFFICIENT_EVIDENCE"
        });
      } else {
        text = JSON.stringify({
          answer: "Based on verified airline documentation (SOP-OPS-737-04), the sterile cockpit rule is strictly enforced below 10,000 feet MSL.",
          evidenceReferences: [
            {
              documentId: "SOP-OPS-737-04",
              title: "Boeing 737 Sterile Cockpit and Critical Phase Procedures",
              section: "1. Sterile Cockpit Environment",
              page: 1,
              effectiveDate: "2024-03-01",
              status: "APPROVED",
              quote: "The sterile cockpit rule is strictly enforced during all critical phases below 10,000 feet MSL."
            }
          ],
          applicabilityStatus: "APPLICABLE",
          uncertainty: {
            level: "LOW",
            score: 0.05,
            reason: "Direct statement in current approved SOP"
          },
          refusalReason: null
        });
      }
    } else {
      // Default domain-relevant mock answer for airline procedure verification
      text = `[AERORAG MOCK COMPLETION]
1. Procedure Verification: The requested flight operation adheres to Standard Operating Procedures (SOP-OPS-737-04).
2. Authoritative Source: Boeing 737 Flight Crew Operations Manual, Section 3.
3. Status: Current and approved for active operational service.`;
    }

    // Apply stopSequences if specified
    const stopSequences = paramValidation.parameters.stopSequences || [];
    if (Array.isArray(stopSequences) && stopSequences.length > 0) {
      for (const seq of stopSequences) {
        const idx = text.indexOf(seq);
        if (idx !== -1) {
          text = text.substring(0, idx);
        }
      }
    }

    // Apply maxOutputTokens simulation
    const maxTokens = paramValidation.parameters.maxOutputTokens || 500;
    if (text.length > maxTokens * 4) {
      text = text.substring(0, maxTokens * 4) + '... [TRUNCATED]';
    }

    const promptTokens = Math.ceil(promptText.length / 4);
    const completionTokens = Math.ceil(text.length / 4);
    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens
    };

    const modelName = callOptions.model || this.model;
    const cost = calculateCost(usage, modelName);

    return {
      text,
      model: modelName,
      provider: 'mock',
      usage,
      cost,
      finishReason: 'STOP',
      latencyMs: this.simulatedLatencyMs,
      metadata: {
        temperature: paramValidation.parameters.temperature,
        maxOutputTokens: maxTokens,
        topP: paramValidation.parameters.topP,
        topK: paramValidation.parameters.topK,
        stopSequences,
        parameterWarnings: paramValidation.warnings,
        unsupportedParameters: paramValidation.unsupportedParameters
      },
      raw: { mock: true, promptText, callIndex: this.callCount }
    };
  }

  get lastCall() {
    return this.history[this.history.length - 1] || null;
  }
}

// ============================================================================
// Client Factory & Singleton
// ============================================================================

/**
 * Creates an LLM adapter instance according to configuration or overrides.
 * @param {object} [options]
 * @returns {BaseLLMAdapter}
 */
export function createLLMClient(options = {}) {
  const useMock =
    options.mock === true ||
    options.provider === 'mock' ||
    config.LLM_PROVIDER === 'mock' ||
    (config.DEMO_MODE && !options.apiKey && !config.GOOGLE_API_KEY && !config.GEMINI_API_KEY);

  if (useMock) {
    return new MockLLMAdapter(options);
  }

  return new GeminiAdapter(options);
}

// Default cached singleton client
let defaultClient = null;

export function getLLMClient(options = {}) {
  if (!defaultClient || Object.keys(options).length > 0) {
    defaultClient = createLLMClient(options);
  }
  return defaultClient;
}

export {
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
};

export default {
  BaseLLMAdapter,
  GeminiAdapter,
  MockLLMAdapter,
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
};
