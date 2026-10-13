/**
 * AeroRAG Structured Output & JSON Handling Module
 * 
 * Provides:
 * 1. JSON Schema definition for airline procedure RAG responses.
 * 2. Multi-stage resilient JSON parser (handling markdown fences, preambles, syntax repairs).
 * 3. Schema validator for required fields with automated recovery.
 * 4. Graceful error reporting to prevent unhandled runtime crashes.
 */

export const STRUCTURED_RAG_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "Direct verified answer based only on retrieved documents"
    },
    source: {
      type: "object",
      properties: {
        documentId: { type: "string" },
        title: { type: "string" },
        status: { type: "string", enum: ["APPROVED", "SUPERSEDED", "DRAFT", "ACTIVE"] },
        effectiveDate: { type: "string" }
      },
      required: ["documentId", "title", "status"]
    },
    confidence: {
      type: "number",
      description: "Confidence score between 0.0 and 1.0"
    },
    supersededNotes: {
      type: ["string", "null"],
      description: "Notes on superseded or outdated documents, or null if none"
    },
    isGrounded: {
      type: "boolean",
      description: "True if the answer is strictly grounded in retrieved airline SOPs"
    }
  },
  required: ["answer", "source"]
};

export const STRUCTURED_SYSTEM_PROMPT = `You are AeroRAG, an airline procedure verification assistant.
You must respond ONLY with a valid JSON object matching this exact schema:
{
  "answer": "Direct verified operational instruction based only on retrieved documents",
  "source": {
    "documentId": "ID of authoritative document",
    "title": "Title of document",
    "status": "APPROVED",
    "effectiveDate": "YYYY-MM-DD"
  },
  "confidence": 0.95,
  "supersededNotes": "Notes about superseded documents or null",
  "isGrounded": true
}

Rules:
1. Return ONLY the raw JSON object. Do NOT wrap in markdown backticks (\`\`\`json).
2. Never invent procedures, regulations, dates, or operational instructions.
3. If documents lack sufficient information, set answer to "I could not find sufficient information in the available airline documents." and isGrounded to false.
4. Prefer the latest valid document according to effective date and supersession status.`;

/**
 * Stage-based resilient JSON parser
 * Recovers from:
 * - Markdown fences (```json ... ```)
 * - Conversational preambles & postscripts
 * - Trailing commas
 * - Single quotes or unquoted keys
 * - Truncated responses (via heuristic regex extraction)
 */
export function parseStructuredOutput(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return {
      success: false,
      stage: 'EMPTY_INPUT',
      recovered: false,
      error: 'Input is empty or not a string',
      data: null,
      rawText: rawText || ''
    };
  }

  const trimmed = rawText.trim();
  let warnings = [];

  // Stage 1: Direct JSON.parse
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        success: true,
        stage: 'DIRECT_PARSE',
        recovered: false,
        warnings: [],
        data: parsed,
        rawText
      };
    }
  } catch (e) {
    // Continue to recovery stages
  }

  // Stage 2: Strip Markdown Code Fences (```json ... ``` or ``` ... ```)
  let cleaned = trimmed;
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
    warnings.push('Stripped markdown code fences from response');
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        return {
          success: true,
          stage: 'MARKDOWN_STRIP',
          recovered: true,
          warnings,
          data: parsed,
          rawText
        };
      }
    } catch (e) {
      // Continue to next stage
    }
  }

  // Stage 3: Extract from Conversational Preamble & Postscript (find first { to last })
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const bracketExtracted = cleaned.substring(firstBrace, lastBrace + 1);
    if (bracketExtracted !== cleaned) {
      warnings.push('Extracted JSON object from conversational preamble/postscript');
    }
    try {
      const parsed = JSON.parse(bracketExtracted);
      if (parsed && typeof parsed === 'object') {
        return {
          success: true,
          stage: 'EXTRACT_BRACKETS',
          recovered: true,
          warnings,
          data: parsed,
          rawText
        };
      }
    } catch (e) {
      cleaned = bracketExtracted;
    }
  }

  // Stage 4: Syntax Sanitization & Repair
  // 4a. Fix trailing commas before } or ]
  let sanitized = cleaned.replace(/,\s*([}\]])/g, '$1');
  // 4b. Fix unquoted keys: { key: "value" } -> { "key": "value" }
  sanitized = sanitized.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
  // 4c. Fix single quotes to double quotes for string values
  sanitized = sanitized.replace(/:\s*'([^']*)'/g, ': "$1"');

  try {
    const parsed = JSON.parse(sanitized);
    if (parsed && typeof parsed === 'object') {
      warnings.push('Repaired malformed JSON syntax (trailing commas / quote formatting)');
      return {
        success: true,
        stage: 'SYNTAX_REPAIR',
        recovered: true,
        warnings,
        data: parsed,
        rawText
      };
    }
  } catch (e) {
    // Continue to heuristic regex fallback
  }

  // Stage 5: Heuristic Regex Field Extraction (Recovery from truncated or severely malformed JSON)
  const regexRecovered = extractFieldsHeuristically(rawText);
  if (regexRecovered) {
    warnings.push('Recovered required fields via heuristic regex extraction from damaged JSON');
    return {
      success: true,
      stage: 'HEURISTIC_REGEX_RECOVERY',
      recovered: true,
      warnings,
      data: regexRecovered,
      rawText
    };
  }

  // Stage 6: Graceful Failure Reporting (Never throw unhandled exception)
  return {
    success: false,
    stage: 'PARSE_FAILED',
    recovered: false,
    error: 'Malformed JSON: Unable to parse or recover valid JSON structure from LLM output',
    data: null,
    warnings,
    rawText
  };
}

/**
 * Heuristic regex extractor for damaged / truncated JSON
 */
function extractFieldsHeuristically(text) {
  // Extract answer
  const answerMatch = text.match(/["']?answer["']?\s*:\s*["']([^"'\\]*(?:\\.[^"'\\]*)*)["']?/i);
  if (!answerMatch || !answerMatch[1] || answerMatch[1].trim().length === 0) {
    return null;
  }

  const answer = answerMatch[1].replace(/\\"/g, '"').trim();

  // Extract source documentId
  const docIdMatch = text.match(/["']?documentId["']?\s*:\s*["']([^"'\\]+)["']?/i);
  const titleMatch = text.match(/["']?title["']?\s*:\s*["']([^"'\\]+)["']?/i);
  const statusMatch = text.match(/["']?status["']?\s*:\s*["']([A-Z_]+)["']?/i);
  const confMatch = text.match(/["']?confidence["']?\s*:\s*([0-9.]+)/i);
  const notesMatch = text.match(/["']?supersededNotes["']?\s*:\s*["']([^"'\\]+)["']?/i);
  const groundedMatch = text.match(/["']?isGrounded["']?\s*:\s*(true|false)/i);

  const source = {
    documentId: docIdMatch ? docIdMatch[1] : 'UNKNOWN_DOC',
    title: titleMatch ? titleMatch[1] : 'Referenced Procedure Document',
    status: statusMatch ? statusMatch[1] : 'APPROVED'
  };

  return {
    answer,
    source,
    confidence: confMatch ? parseFloat(confMatch[1]) : 0.85,
    supersededNotes: notesMatch ? notesMatch[1] : null,
    isGrounded: groundedMatch ? groundedMatch[1].toLowerCase() === 'true' : true
  };
}

/**
 * Validate required fields and normalize types
 * Required fields: "answer" and "source"
 */
export function validateStructuredOutput(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      valid: false,
      errors: ['Output must be a non-null JSON object'],
      warnings,
      data: null
    };
  }

  const normalized = { ...data };

  // 1. Validate 'answer'
  if (!normalized.answer || typeof normalized.answer !== 'string' || normalized.answer.trim().length === 0) {
    // Attempt recovery from alternative keys
    const altAnswer = normalized.response || normalized.directAnswer || normalized.result || normalized.content;
    if (altAnswer && typeof altAnswer === 'string' && altAnswer.trim().length > 0) {
      normalized.answer = altAnswer.trim();
      warnings.push(`Recovered 'answer' from alternative key`);
    } else {
      errors.push("Missing or empty required field: 'answer'");
    }
  } else {
    normalized.answer = normalized.answer.trim();
  }

  // 2. Validate 'source'
  if (!normalized.source) {
    // Attempt recovery from 'sources' array or 'document'
    if (Array.isArray(normalized.sources) && normalized.sources.length > 0) {
      const firstSrc = normalized.sources[0];
      if (typeof firstSrc === 'object') {
        normalized.source = firstSrc;
      } else {
        normalized.source = { documentId: String(firstSrc), title: 'Referenced Document', status: 'APPROVED' };
      }
      warnings.push("Recovered 'source' from 'sources' array");
    } else if (typeof normalized.documentId === 'string') {
      normalized.source = {
        documentId: normalized.documentId,
        title: normalized.documentTitle || 'Referenced Document',
        status: normalized.documentStatus || 'APPROVED'
      };
      warnings.push("Constructed 'source' object from top-level document fields");
    } else {
      errors.push("Missing required field: 'source'");
    }
  } else if (typeof normalized.source === 'string') {
    // Normalize string source to object
    normalized.source = {
      documentId: normalized.source,
      title: 'Referenced Document',
      status: 'APPROVED'
    };
    warnings.push("Normalized string 'source' to structured object");
  } else if (typeof normalized.source === 'object') {
    if (!normalized.source.documentId) {
      normalized.source.documentId = 'DOC-UNKNOWN';
      warnings.push("Defaulted missing 'source.documentId' to 'DOC-UNKNOWN'");
    }
    if (!normalized.source.title) {
      normalized.source.title = 'Airline Procedure Document';
      warnings.push("Defaulted missing 'source.title'");
    }
    if (!normalized.source.status) {
      normalized.source.status = 'APPROVED';
      warnings.push("Defaulted missing 'source.status' to 'APPROVED'");
    }
  } else {
    errors.push("Field 'source' must be an object or string identifier");
  }

  // 3. Normalize optional fields
  if (normalized.confidence !== undefined) {
    const num = parseFloat(normalized.confidence);
    normalized.confidence = isNaN(num) ? 0.9 : Math.max(0, Math.min(1, num));
  } else {
    normalized.confidence = 0.9;
  }

  if (normalized.isGrounded !== undefined) {
    normalized.isGrounded = Boolean(normalized.isGrounded);
  } else {
    normalized.isGrounded = true;
  }

  if (normalized.supersededNotes === undefined) {
    normalized.supersededNotes = null;
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      data: null
    };
  }

  return {
    valid: true,
    errors: [],
    warnings,
    data: normalized,
    recovered: warnings.length > 0
  };
}

/**
 * End-to-end processing pipeline: Parse -> Validate -> Safe Object
 */
export function processLlmOutput(rawText) {
  const parseResult = parseStructuredOutput(rawText);

  if (!parseResult.success) {
    return {
      success: false,
      valid: false,
      stage: parseResult.stage,
      recovered: false,
      errors: [parseResult.error],
      warnings: parseResult.warnings || [],
      data: null,
      rawText: parseResult.rawText
    };
  }

  const validationResult = validateStructuredOutput(parseResult.data);

  if (!validationResult.valid) {
    return {
      success: false,
      valid: false,
      stage: parseResult.stage,
      recovered: false,
      errors: validationResult.errors,
      warnings: [...(parseResult.warnings || []), ...(validationResult.warnings || [])],
      data: null,
      rawText: parseResult.rawText
    };
  }

  return {
    success: true,
    valid: true,
    stage: parseResult.stage,
    recovered: parseResult.recovered || validationResult.recovered,
    warnings: [...(parseResult.warnings || []), ...(validationResult.warnings || [])],
    errors: [],
    data: validationResult.data,
    rawText: parseResult.rawText
  };
}
