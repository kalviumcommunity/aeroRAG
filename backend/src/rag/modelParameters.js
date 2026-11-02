/**
 * Airline Procedure Intelligence: Model Parameters & Output Control
 * Milestone 3.16
 * 
 * Provides:
 * 1. Configurable model parameters with sensible grounded defaults.
 * 2. Provider capability registry (Gemini vs OpenAI vs Mock).
 * 3. Parameter validation, bounds checking, and type coercion.
 * 4. Explicit detection and handling of provider-specific unsupported parameters.
 */

// ============================================================================
// Parameter Errors
// ============================================================================

export class ModelParameterError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.category = options.category || 'PARAMETER_ERROR';
    this.parameter = options.parameter || null;
    this.details = options.details || null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class ModelParameterValidationError extends ModelParameterError {
  constructor(message, options = {}) {
    super(message, {
      category: 'VALIDATION_ERROR',
      ...options
    });
  }
}

export class UnsupportedParameterError extends ModelParameterError {
  constructor(parameter, provider, options = {}) {
    super(`Parameter '${parameter}' is not supported by provider '${provider}'.`, {
      category: 'UNSUPPORTED_PARAMETER',
      parameter,
      details: {
        provider,
        supportedParameters: options.supportedParameters || []
      },
      ...options
    });
  }
}

// ============================================================================
// Default Grounded Configuration
// ============================================================================

export const DEFAULT_GROUNDED_PARAMETERS = {
  temperature: 0.1,        // Deterministic, grounded generation
  maxOutputTokens: 500,    // Protects token budget & prevents runaway output
  topP: 0.8,               // Focuses on high-probability procedure tokens
  topK: 40,                // Narrows vocabulary candidates
  stopSequences: []        // Delimiter sequences to halt generation
};

// ============================================================================
// Provider Capabilities Matrix
// ============================================================================

export const PROVIDER_CAPABILITIES = {
  gemini: {
    name: 'Google Gemini',
    supportedParameters: [
      'temperature',
      'maxOutputTokens',
      'topP',
      'topK',
      'stopSequences',
      'responseMimeType',
      'responseSchema'
    ],
    unsupportedParameters: [
      'presencePenalty',
      'frequencyPenalty',
      'logitBias',
      'seed',
      'n',
      'bestOf'
    ],
    paramAliases: {
      max_tokens: 'maxOutputTokens',
      maxTokens: 'maxOutputTokens',
      stop: 'stopSequences',
      response_format: 'responseMimeType'
    },
    bounds: {
      temperature: { min: 0.0, max: 2.0, default: 0.1 },
      maxOutputTokens: { min: 1, max: 8192, default: 500 },
      topP: { min: 0.0, max: 1.0, default: 0.8 },
      topK: { min: 1, max: 100, default: 40 }
    }
  },

  openai: {
    name: 'OpenAI Chat Completions',
    supportedParameters: [
      'temperature',
      'max_tokens',
      'top_p',
      'stop',
      'presencePenalty',
      'frequencyPenalty',
      'logitBias',
      'seed',
      'response_format'
    ],
    unsupportedParameters: [
      'topK',
      'responseMimeType'
    ],
    paramAliases: {
      maxOutputTokens: 'max_tokens',
      stopSequences: 'stop'
    },
    bounds: {
      temperature: { min: 0.0, max: 2.0, default: 0.1 },
      max_tokens: { min: 1, max: 4096, default: 500 },
      top_p: { min: 0.0, max: 1.0, default: 0.8 },
      presencePenalty: { min: -2.0, max: 2.0, default: 0.0 },
      frequencyPenalty: { min: -2.0, max: 2.0, default: 0.0 }
    }
  },

  mock: {
    name: 'Mock Adapter',
    supportedParameters: [
      'temperature',
      'maxOutputTokens',
      'max_tokens',
      'topP',
      'topK',
      'stopSequences',
      'presencePenalty',
      'frequencyPenalty',
      'responseMimeType',
      'responseSchema'
    ],
    unsupportedParameters: [],
    paramAliases: {
      max_tokens: 'maxOutputTokens',
      stop: 'stopSequences'
    },
    bounds: {
      temperature: { min: 0.0, max: 2.0, default: 0.1 },
      maxOutputTokens: { min: 1, max: 10000, default: 500 },
      topP: { min: 0.0, max: 1.0, default: 0.8 },
      topK: { min: 1, max: 100, default: 40 }
    }
  }
};

// ============================================================================
// Parameter Validation & Normalization
// ============================================================================

/**
 * Validates and normalizes model parameters for a specified provider.
 * 
 * @param {object} params - Raw parameters passed by caller
 * @param {string} [provider='gemini'] - Target provider name ('gemini', 'openai', 'mock')
 * @param {object} [options]
 * @param {boolean} [options.strict=false] - If true, throws on unsupported or out-of-bounds params
 * @param {boolean} [options.clampOutOfBounds=true] - If true, clamps numbers to valid ranges
 * @returns {{
 *   valid: boolean,
 *   parameters: object,
 *   warnings: string[],
 *   unsupportedParameters: string[],
 *   errors: string[]
 * }}
 */
export function validateModelParameters(params = {}, provider = 'gemini', options = {}) {
  const strict = Boolean(options.strict);
  const clamp = options.clampOutOfBounds !== false;
  const warnings = [];
  const unsupportedParameters = [];
  const errors = [];

  const providerSpec = PROVIDER_CAPABILITIES[provider] || PROVIDER_CAPABILITIES.gemini;
  const resultParams = { ...DEFAULT_GROUNDED_PARAMETERS };

  if (!params || typeof params !== 'object') {
    return {
      valid: true,
      parameters: resultParams,
      warnings: ['No parameter object provided, using grounded defaults'],
      unsupportedParameters: [],
      errors: []
    };
  }

  // 1. Process Aliases
  const normalizedInput = {};
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined || val === null) continue;
    const targetKey = providerSpec.paramAliases[key] || key;
    normalizedInput[targetKey] = val;
  }

  // 2. Check for Unsupported Parameters
  for (const key of Object.keys(normalizedInput)) {
    const isSupported = providerSpec.supportedParameters.includes(key);
    const isExplicitlyUnsupported = providerSpec.unsupportedParameters.includes(key);

    if (!isSupported || isExplicitlyUnsupported) {
      unsupportedParameters.push(key);
      const msg = `Provider '${provider}' does not support parameter '${key}'.`;
      warnings.push(msg);

      if (strict) {
        errors.push(msg);
      }
    }
  }

  if (strict && errors.length > 0) {
    throw new UnsupportedParameterError(unsupportedParameters[0], provider, {
      supportedParameters: providerSpec.supportedParameters,
      details: { allUnsupported: unsupportedParameters, errors }
    });
  }

  // 3. Validate & Clamp Supported Parameters

  // Temperature
  if (normalizedInput.temperature !== undefined) {
    const temp = Number(normalizedInput.temperature);
    if (isNaN(temp)) {
      const err = `Invalid temperature: '${normalizedInput.temperature}' is not a number.`;
      if (strict) throw new ModelParameterValidationError(err, { parameter: 'temperature' });
      warnings.push(`${err} Using default 0.1.`);
      resultParams.temperature = 0.1;
    } else if (temp < 0.0 || temp > 2.0) {
      const err = `Temperature ${temp} is out of bounds [0.0, 2.0].`;
      if (strict) throw new ModelParameterValidationError(err, { parameter: 'temperature' });
      if (clamp) {
        resultParams.temperature = Math.max(0.0, Math.min(2.0, temp));
        warnings.push(`${err} Clamped to ${resultParams.temperature}.`);
      } else {
        resultParams.temperature = 0.1;
        warnings.push(`${err} Using default 0.1.`);
      }
    } else {
      resultParams.temperature = temp;
    }
  }

  // maxOutputTokens
  const maxTokensKey = provider === 'openai' ? 'max_tokens' : 'maxOutputTokens';
  if (normalizedInput[maxTokensKey] !== undefined) {
    const maxTokens = Number(normalizedInput[maxTokensKey]);
    if (isNaN(maxTokens) || !Number.isInteger(maxTokens) || maxTokens <= 0) {
      const err = `Invalid ${maxTokensKey}: must be a positive integer.`;
      if (strict) throw new ModelParameterValidationError(err, { parameter: maxTokensKey });
      warnings.push(`${err} Using default 500.`);
      resultParams[maxTokensKey] = 500;
    } else if (maxTokens > 8192) {
      const err = `${maxTokensKey} (${maxTokens}) exceeds maximum allowable 8192.`;
      if (strict) throw new ModelParameterValidationError(err, { parameter: maxTokensKey });
      if (clamp) {
        resultParams[maxTokensKey] = 8192;
        warnings.push(`${err} Clamped to 8192.`);
      } else {
        resultParams[maxTokensKey] = 500;
      }
    } else {
      resultParams[maxTokensKey] = maxTokens;
    }
  }

  // topP
  if (normalizedInput.topP !== undefined) {
    const p = Number(normalizedInput.topP);
    if (isNaN(p) || p < 0.0 || p > 1.0) {
      const err = `Invalid topP: must be a number between 0.0 and 1.0.`;
      if (strict) throw new ModelParameterValidationError(err, { parameter: 'topP' });
      warnings.push(`${err} Using default 0.8.`);
      resultParams.topP = 0.8;
    } else {
      resultParams.topP = p;
    }
  }

  // topK
  if (normalizedInput.topK !== undefined) {
    const k = Number(normalizedInput.topK);
    if (isNaN(k) || !Number.isInteger(k) || k < 1 || k > 100) {
      const err = `Invalid topK: must be an integer between 1 and 100.`;
      if (strict) throw new ModelParameterValidationError(err, { parameter: 'topK' });
      warnings.push(`${err} Using default 40.`);
      resultParams.topK = 40;
    } else {
      resultParams.topK = k;
    }
  }

  // stopSequences
  if (normalizedInput.stopSequences !== undefined) {
    if (!Array.isArray(normalizedInput.stopSequences)) {
      const err = `stopSequences must be an array of strings.`;
      if (strict) throw new ModelParameterValidationError(err, { parameter: 'stopSequences' });
      warnings.push(err);
      resultParams.stopSequences = [];
    } else {
      resultParams.stopSequences = normalizedInput.stopSequences
        .filter(s => typeof s === 'string' && s.length > 0)
        .slice(0, 5); // limit to max 5 stop sequences
    }
  }

  // responseMimeType & responseSchema
  if (normalizedInput.responseMimeType !== undefined) {
    resultParams.responseMimeType = String(normalizedInput.responseMimeType);
  }
  if (normalizedInput.responseSchema !== undefined) {
    resultParams.responseSchema = normalizedInput.responseSchema;
  }

  return {
    valid: errors.length === 0,
    parameters: resultParams,
    warnings,
    unsupportedParameters,
    errors
  };
}

export default {
  ModelParameterError,
  ModelParameterValidationError,
  UnsupportedParameterError,
  DEFAULT_GROUNDED_PARAMETERS,
  PROVIDER_CAPABILITIES,
  validateModelParameters
};
