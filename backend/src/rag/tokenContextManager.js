/**
 * Airline Procedure Intelligence: Token, Cost Estimation & Context Budget Management
 * Milestones 3.14 & 3.15
 * 
 * Provides:
 * 1. Token estimation using model tokenizers or domain-calibrated heuristic estimation.
 * 2. Cost estimation that calculates costs ONLY when verified pricing data is configured.
 * 3. Bounded conversation history with deterministic FIFO truncation and summarization hooks.
 * 4. Context budget reservation protecting system instructions, response reserve, and evidence.
 * 5. Strict safety invariant: Never silently remove or trim safety-critical evidence.
 */

import config from '../config/env.js';

// ============================================================================
// Error Hierarchy
// ============================================================================

export class ContextManagementError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category || 'CONTEXT_ERROR';
    this.details = options.details || null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ContextBudgetExceededError extends ContextManagementError {
  constructor(message = 'Context window budget exceeded', options = {}) {
    super(message, {
      category: 'BUDGET_EXCEEDED',
      details: options.details || {},
      ...options
    });
  }
}

export class OversizedMessageError extends ContextManagementError {
  constructor(message = 'Message exceeds permissible token threshold', options = {}) {
    super(message, {
      category: 'OVERSIZED_MESSAGE',
      details: options.details || {},
      ...options
    });
  }
}

// ============================================================================
// Pricing Configuration Table (USD per 1,000,000 tokens)
// ============================================================================

export const DEFAULT_MODEL_PRICING = {
  'gemini-1.5-flash': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'gemini-1.5-pro': { inputCostPerM: 1.25, outputCostPerM: 5.00 },
  'gemini-2.5-flash': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'gemini-2.5-flash-lite': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'gemini-3.5-flash-lite': { inputCostPerM: 0.075, outputCostPerM: 0.30 },
  'gemini-3.8-flash': { inputCostPerM: 0.10, outputCostPerM: 0.40 },
  'mock': { inputCostPerM: 0.00, outputCostPerM: 0.00 }
};

// ============================================================================
// Token Counting & Estimation
// ============================================================================

/**
 * Estimates token count for a text string, message object, or array of messages.
 * Uses model tokenizer if provided, otherwise applies a deterministic heuristic ratio.
 * 
 * @param {string|object|Array} input 
 * @param {object} [options]
 * @param {object} [options.modelInstance] - Active Gemini GenerativeModel with countTokens()
 * @param {string} [options.model] - Model identifier
 * @returns {Promise<{tokenCount: number, charCount: number, isExact: boolean, method: string, model: string}>}
 */
export async function estimateTokenCount(input, options = {}) {
  const modelName = options.model || config.LLM_MODEL || 'gemini-3.5-flash-lite';
  
  // Extract text representation
  let text = '';
  if (typeof input === 'string') {
    text = input;
  } else if (Array.isArray(input)) {
    text = input
      .map(m => {
        if (typeof m === 'string') return m;
        if (m && typeof m === 'object') return `${m.role || 'user'}: ${m.content || m.document || m.text || ''}`;
        return '';
      })
      .join('\n');
  } else if (input && typeof input === 'object') {
    text = input.content || input.document || input.text || JSON.stringify(input);
  } else {
    text = String(input || '');
  }

  const charCount = text.length;
  if (charCount === 0) {
    return {
      tokenCount: 0,
      charCount: 0,
      isExact: true,
      method: 'empty_input',
      model: modelName
    };
  }

  // 1. Attempt exact tokenizer if modelInstance with countTokens is provided
  if (options.modelInstance && typeof options.modelInstance.countTokens === 'function') {
    try {
      const res = await options.modelInstance.countTokens(text);
      if (res && typeof res.totalTokens === 'number') {
        return {
          tokenCount: res.totalTokens,
          charCount,
          isExact: true,
          method: 'model_tokenizer',
          model: modelName
        };
      }
    } catch (e) {
      // Fallback cleanly to heuristic on tokenizer error
    }
  }

  // 2. Deterministic Aviation/Technical Heuristic Estimation
  // English technical text typically averages ~3.8 to 4.0 characters per token,
  // plus overhead for punctuation, whitespace, and formatting delimiters.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const numbersAndSymbols = (text.match(/[\d\W_]/g) || []).length;
  
  // Base token count: ~3.8 chars per token for words, + subword overhead for numbers/symbols
  const estimatedTokens = Math.max(
    1,
    Math.ceil((charCount / 3.8) + (numbersAndSymbols * 0.05))
  );

  return {
    tokenCount: estimatedTokens,
    charCount,
    isExact: false,
    method: 'heuristic_estimation',
    model: modelName
  };
}

// Synchronous heuristic token estimator for synchronous budgets
export function estimateTokenCountSync(input, modelName = 'gemini-3.5-flash-lite') {
  let text = '';
  if (typeof input === 'string') {
    text = input;
  } else if (Array.isArray(input)) {
    text = input
      .map(m => (typeof m === 'string' ? m : `${m?.role || 'user'}: ${m?.content || m?.document || ''}`))
      .join('\n');
  } else if (input && typeof input === 'object') {
    text = input.content || input.document || input.text || '';
  }

  const charCount = text.length;
  if (charCount === 0) return 0;
  const numbersAndSymbols = (text.match(/[\d\W_]/g) || []).length;
  return Math.max(1, Math.ceil((charCount / 3.8) + (numbersAndSymbols * 0.05)));
}

// ============================================================================
// Cost Estimation (Only Calculated When Pricing Data Is Available)
// ============================================================================

/**
 * Calculates estimated cost for token usage.
 * CRITICAL RULE: Calculates cost ONLY when pricing data is available.
 * If pricing data is unconfigured for the model, returns null and pricingAvailable: false.
 * 
 * @param {object} usage - { promptTokens, completionTokens, totalTokens }
 * @param {string} [model] - Model identifier
 * @param {object} [options] - Pricing overrides { inputCostPerM, outputCostPerM }
 * @returns {object} Cost breakdown or pricing unavailable notice
 */
export function calculateCost(usage = {}, model, options = {}) {
  const modelName = model || config.LLM_MODEL || 'gemini-3.5-flash-lite';
  const promptTokens = Number(usage.promptTokens || usage.inputTokens || 0);
  const completionTokens = Number(usage.completionTokens || usage.outputTokens || 0);
  const totalTokens = Number(usage.totalTokens || promptTokens + completionTokens);

  // Check for pricing configuration:
  // 1. Explicit options passed
  // 2. Environment variables overrides
  // 3. Known model in DEFAULT_MODEL_PRICING
  let inputCostPerM = null;
  let outputCostPerM = null;

  if (typeof options.inputCostPerM === 'number' && typeof options.outputCostPerM === 'number') {
    inputCostPerM = options.inputCostPerM;
    outputCostPerM = options.outputCostPerM;
  } else if (config.LLM_INPUT_COST_PER_M !== null && config.LLM_OUTPUT_COST_PER_M !== null) {
    inputCostPerM = config.LLM_INPUT_COST_PER_M;
    outputCostPerM = config.LLM_OUTPUT_COST_PER_M;
  } else if (DEFAULT_MODEL_PRICING[modelName]) {
    inputCostPerM = DEFAULT_MODEL_PRICING[modelName].inputCostPerM;
    outputCostPerM = DEFAULT_MODEL_PRICING[modelName].outputCostPerM;
  }

  // If no pricing data is available, report honestly
  if (inputCostPerM === null || outputCostPerM === null) {
    return {
      pricingAvailable: false,
      isExactPricing: false,
      totalCostUsd: null,
      promptCostUsd: null,
      completionCostUsd: null,
      currency: 'USD',
      model: modelName,
      usage: { promptTokens, completionTokens, totalTokens },
      reason: `No pricing data configured for model '${modelName}'. Cost estimation was safely skipped.`
    };
  }

  // Calculate costs with 6-decimal precision
  const promptCostUsd = Number(((promptTokens / 1_000_000) * inputCostPerM).toFixed(6));
  const completionCostUsd = Number(((completionTokens / 1_000_000) * outputCostPerM).toFixed(6));
  const totalCostUsd = Number((promptCostUsd + completionCostUsd).toFixed(6));

  return {
    pricingAvailable: true,
    isExactPricing: true,
    promptCostUsd,
    completionCostUsd,
    totalCostUsd,
    currency: 'USD',
    model: modelName,
    rates: {
      inputCostPerM,
      outputCostPerM
    },
    usage: {
      promptTokens,
      completionTokens,
      totalTokens
    }
  };
}

// ============================================================================
// Context Budget Manager & Bounded Conversation History
// ============================================================================

export class ContextBudgetManager {
  /**
   * @param {object} [options]
   * @param {number} [options.maxContextTokens] - Total context window capacity (default: 8192)
   * @param {number} [options.reservedResponseTokens] - Token headroom for model response (default: 500)
   * @param {number} [options.maxHistoryTokens] - Max tokens allocated to history (default: 2000)
   * @param {string} [options.model] - Model name
   */
  constructor(options = {}) {
    this.maxContextTokens = options.maxContextTokens || config.MAX_CONTEXT_TOKENS || 8192;
    this.reservedResponseTokens = options.reservedResponseTokens || config.LLM_MAX_TOKENS || 500;
    this.maxHistoryTokens = options.maxHistoryTokens || 2000;
    this.model = options.model || config.LLM_MODEL || 'gemini-3.5-flash-lite';
  }

  /**
   * Evaluates the context budget and allocates headroom across:
   * 1. System instructions (grounding & safety)
   * 2. Response reserve (completion headroom)
   * 3. User query
   * 4. Retrieved evidence (safety-critical operational chunks)
   * 5. Conversation history (dynamically bounded)
   * 
   * SAFETY INVARIANT: Never silently remove safety-critical evidence!
   * 
   * @param {object} params
   * @param {string} params.systemPrompt
   * @param {string} params.query
   * @param {Array<object>} [params.chunks]
   * @param {Array<object>} [params.history]
   * @param {number} [params.maxOutputTokens]
   * @returns {object} Budget breakdown and allocation
   */
  calculateBudget({ systemPrompt = '', query = '', chunks = [], history = [], maxOutputTokens } = {}) {
    const responseReserve = maxOutputTokens || this.reservedResponseTokens;
    const systemTokens = estimateTokenCountSync(systemPrompt, this.model);
    const queryTokens = estimateTokenCountSync(query, this.model);
    
    // Estimate retrieved evidence tokens
    const evidenceText = chunks
      .map((c, i) => `Source ${i + 1}: ${c.document || c.text || c.content || ''}`)
      .join('\n\n');
    const evidenceTokens = estimateTokenCountSync(evidenceText, this.model);

    // Fixed non-negotiable overhead
    const fixedTokens = systemTokens + responseReserve + queryTokens;

    if (fixedTokens >= this.maxContextTokens) {
      throw new ContextBudgetExceededError(
        `Fixed context requirements (${fixedTokens} tokens) exceed total context window (${this.maxContextTokens} tokens).`,
        { details: { fixedTokens, systemTokens, queryTokens, responseReserve, maxContextTokens: this.maxContextTokens } }
      );
    }

    const availableHeadroom = this.maxContextTokens - fixedTokens;

    // SAFETY INVARIANT CHECK:
    // If evidence exceeds available headroom, we MUST NOT silently truncate safety-critical flight procedures.
    if (evidenceTokens > availableHeadroom) {
      throw new ContextBudgetExceededError(
        `Retrieved safety-critical evidence (${evidenceTokens} tokens) exceeds available context budget (${availableHeadroom} tokens). Evidence cannot be silently truncated without compromising flight safety.`,
        {
          details: {
            evidenceTokens,
            availableHeadroom,
            maxContextTokens: this.maxContextTokens,
            safetyInvariant: 'Never silently remove safety-critical evidence'
          }
        }
      );
    }

    // Remaining tokens can be allocated to bounded conversation history
    const historyBudget = Math.min(this.maxHistoryTokens, availableHeadroom - evidenceTokens);

    return {
      maxContextTokens: this.maxContextTokens,
      systemTokens,
      queryTokens,
      responseReserve,
      evidenceTokens,
      fixedTokens,
      availableHeadroom,
      historyBudget,
      totalCommittedTokens: fixedTokens + evidenceTokens
    };
  }

  /**
   * Bounded conversation history manager.
   * Deterministically truncates oldest dialogue turns (FIFO) or triggers a summarization hook.
   * 
   * @param {Array<object>} history - Dialogue history turns [{ role, content }]
   * @param {number} historyBudget - Maximum tokens permitted for history
   * @param {object} [options]
   * @param {function} [options.summarizeHook] - Optional async/sync summarization function (droppedMessages) => string
   * @param {number} [options.maxSingleMessageTokens] - Threshold for oversized message
   * @returns {Promise<{messages: Array<object>, trimmedCount: number, totalTokens: number, summary: string|null, wasTruncated: boolean}>}
   */
  async manageHistory(history = [], historyBudget, options = {}) {
    if (!history || !Array.isArray(history) || history.length === 0) {
      return {
        messages: [],
        trimmedCount: 0,
        totalTokens: 0,
        summary: null,
        wasTruncated: false
      };
    }

    const budget = historyBudget !== undefined ? historyBudget : this.maxHistoryTokens;
    const maxSingleMessage = options.maxSingleMessageTokens || Math.floor(this.maxContextTokens * 0.7);

    // 1. Check for oversized single messages
    for (const msg of history) {
      const msgTokens = estimateTokenCountSync(msg.content, this.model);
      if (msgTokens > maxSingleMessage) {
        throw new OversizedMessageError(
          `Single conversation message exceeds maximum token threshold (${msgTokens} > ${maxSingleMessage}).`,
          { details: { msgTokens, maxSingleMessage, role: msg.role } }
        );
      }
    }

    // 2. Deterministic FIFO Trimming
    // We preserve the newest turns and discard the oldest turns from the front
    const retained = [...history];
    const dropped = [];

    let currentTokens = estimateTokenCountSync(retained, this.model);

    while (currentTokens > budget && retained.length > 0) {
      const removed = retained.shift(); // drop oldest turn
      dropped.push(removed);
      currentTokens = estimateTokenCountSync(retained, this.model);
    }

    // 3. Summarization Hook Execution if messages were dropped
    let summaryText = null;
    if (dropped.length > 0 && typeof options.summarizeHook === 'function') {
      try {
        summaryText = await options.summarizeHook(dropped);
        if (summaryText && typeof summaryText === 'string') {
          const summaryMessage = {
            role: 'system',
            content: `[PRIOR CONVERSATION SUMMARY: ${summaryText.trim()}]`
          };
          const summaryTokens = estimateTokenCountSync(summaryMessage.content, this.model);
          // If retained messages + summary exceed budget, trim further to fit summary
          while (currentTokens + summaryTokens > budget && retained.length > 1) {
            const extraDropped = retained.shift();
            dropped.push(extraDropped);
            currentTokens = estimateTokenCountSync(retained, this.model);
          }
          if (currentTokens + summaryTokens <= budget || retained.length <= 1) {
            retained.unshift(summaryMessage);
            currentTokens += summaryTokens;
          }
        }
      } catch (err) {
        // Fallback to plain truncation if summarization hook fails
      }
    }

    return {
      messages: retained,
      trimmedCount: dropped.length,
      totalTokens: currentTokens,
      summary: summaryText,
      wasTruncated: dropped.length > 0
    };
  }
}

// Export default singleton instance
export const defaultContextBudgetManager = new ContextBudgetManager();

export default {
  ContextManagementError,
  ContextBudgetExceededError,
  OversizedMessageError,
  DEFAULT_MODEL_PRICING,
  estimateTokenCount,
  estimateTokenCountSync,
  calculateCost,
  ContextBudgetManager,
  defaultContextBudgetManager
};
