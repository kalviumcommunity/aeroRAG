/**
 * AeroRAG Structured Output & JSON Handling Module
 * Milestones 3.16 & 3.17
 * 
 * Provides:
 * 1. Typed response schema containing:
 *    - answer text
 *    - evidence references
 *    - applicability status
 *    - uncertainty
 *    - refusal reason
 * 2. Multi-stage resilient JSON parser (recovering from fences, preambles, syntax errors, truncated streams).
 * 3. Schema field validator & enum normalizer (handling missing fields, unsupported enum values).
 * 4. Anti-fabrication guarantees: Never fabricates evidence when missing or refused.
 */

// ============================================================================
// Standard Enums
// ============================================================================

export const APPLICABILITY_STATUSES = [
  'APPLICABLE',
  'SUPERSEDED',
  'HISTORICAL',
  'CONDITIONAL',
  'NOT_APPLICABLE',
  'UNKNOWN'
];

export const UNCERTAINTY_LEVELS = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'COMPLETE'
];

export const REFUSAL_REASONS = [
  'INSUFFICIENT_EVIDENCE',
  'SAFETY_RESTRICTION',
  'UNSUPPORTED_PROCEDURE',
  'OUT_OF_DOMAIN'
];

export const DOCUMENT_STATUSES = [
  'APPROVED',
  'ACTIVE',
  'SUPERSEDED',
  'ARCHIVED',
  'DRAFT',
  'UNKNOWN'
];

// ============================================================================
// Typed RAG Response JSON Schema
// ============================================================================

export const STRUCTURED_RAG_SCHEMA = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description: "Direct verified operational instruction or explicit refusal based strictly on evidence"
    },
    evidenceReferences: {
      type: "array",
      description: "List of authoritative flight manual evidence references used to verify answer",
      items: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          title: { type: "string" },
          section: { type: ["string", "null"] },
          page: { type: ["number", "null"] },
          effectiveDate: { type: ["string", "null"] },
          status: { type: "string", enum: DOCUMENT_STATUSES },
          quote: { type: ["string", "null"] }
        },
        required: ["documentId", "title", "status"]
      }
    },
    applicabilityStatus: {
      type: "string",
      enum: APPLICABILITY_STATUSES,
      description: "Operational applicability of the procedure for active flight crew"
    },
    uncertainty: {
      type: "object",
      properties: {
        level: { type: "string", enum: UNCERTAINTY_LEVELS },
        score: { type: "number", minimum: 0.0, maximum: 1.0 },
        reason: { type: ["string", "null"] }
      },
      required: ["level", "score"]
    },
    refusalReason: {
      type: ["string", "null"],
      enum: [...REFUSAL_REASONS, null],
      description: "Reason for procedural refusal if evidence is insufficient or unsafe, otherwise null"
    },
    // Compatibility fields for legacy consumers
    source: {
      type: "object",
      description: "Primary authoritative source (legacy compatibility)"
    },
    confidence: {
      type: "number",
      description: "Confidence score between 0.0 and 1.0 (legacy compatibility)"
    },
    supersededNotes: {
      type: ["string", "null"],
      description: "Notes on superseded documents (legacy compatibility)"
    },
    isGrounded: {
      type: "boolean",
      description: "True if strictly grounded in retrieved evidence (legacy compatibility)"
    }
  },
  required: ["answer", "evidenceReferences", "applicabilityStatus", "uncertainty"]
};

export const STRUCTURED_SYSTEM_PROMPT = `You are AeroRAG, an authoritative airline procedure verification assistant.
You must respond ONLY with a valid JSON object matching this exact schema:
{
  "answer": "Direct verified operational instruction grounded only in retrieved documents",
  "evidenceReferences": [
    {
      "documentId": "SOP-OPS-737-04",
      "title": "Boeing 737 Sterile Cockpit Procedures",
      "section": "1. Sterile Cockpit Environment",
      "page": 1,
      "effectiveDate": "2024-03-01",
      "status": "APPROVED",
      "quote": "The sterile cockpit rule is strictly enforced during all critical phases below 10,000 feet MSL."
    }
  ],
  "applicabilityStatus": "APPLICABLE",
  "uncertainty": {
    "level": "LOW",
    "score": 0.05,
    "reason": "Direct statement in current approved SOP"
  },
  "refusalReason": null
}

Rules:
1. Return ONLY the raw JSON object. Do NOT wrap in markdown fences (\`\`\`json).
2. Never invent procedures, regulations, speeds, or operational instructions.
3. If documents lack sufficient information:
   - set answer to: "I could not find sufficient information in the available airline documents."
   - set evidenceReferences to: []
   - set applicabilityStatus to: "NOT_APPLICABLE"
   - set uncertainty to: {"level": "COMPLETE", "score": 1.0, "reason": "No matching documentation found"}
   - set refusalReason to: "INSUFFICIENT_EVIDENCE"
4. applicabilityStatus MUST be one of: APPLICABLE, SUPERSEDED, HISTORICAL, CONDITIONAL, NOT_APPLICABLE, UNKNOWN.
5. If referring to superseded documents, set applicabilityStatus to "SUPERSEDED" and state the superseding standard.`;

// ============================================================================
// Multi-Stage Resilient Parser
// ============================================================================

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
      warnings: [],
      rawText: rawText || ''
    };
  }

  const trimmed = rawText.trim();
  const warnings = [];

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
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
  let sanitized = cleaned
    // 4a. Fix trailing commas before } or ]
    .replace(/,\s*([}\]])/g, '$1')
    // 4b. Fix unquoted keys: { key: "value" } -> { "key": "value" }
    .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
    // 4c. Fix single quotes to double quotes for string values
    .replace(/:\s*'([^']*)'/g, ': "$1"');

  try {
    const parsed = JSON.parse(sanitized);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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

  // Stage 5: Heuristic Regex Field Extraction (Recovery from truncated or severely damaged JSON)
  const regexRecovered = extractFieldsHeuristically(rawText);
  if (regexRecovered) {
    warnings.push('Recovered required fields via heuristic regex extraction from damaged/truncated JSON');
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

  // Extract documentId
  const docIdMatch = text.match(/["']?documentId["']?\s*:\s*["']([^"'\\]+)["']?/i);
  const titleMatch = text.match(/["']?title["']?\s*:\s*["']([^"'\\]+)["']?/i);
  const statusMatch = text.match(/["']?status["']?\s*:\s*["']([A-Z_]+)["']?/i);
  const applicabilityMatch = text.match(/["']?applicabilityStatus["']?\s*:\s*["']([A-Z_]+)["']?/i);
  const refusalMatch = text.match(/["']?refusalReason["']?\s*:\s*["']([A-Z_]+)["']?/i);
  const confMatch = text.match(/["']?confidence["']?\s*:\s*([0-9.]+)/i);

  const evidenceReferences = [];
  if (docIdMatch) {
    evidenceReferences.push({
      documentId: docIdMatch[1],
      title: titleMatch ? titleMatch[1] : 'Referenced Procedure Document',
      section: null,
      page: null,
      effectiveDate: null,
      status: statusMatch ? statusMatch[1] : 'APPROVED',
      quote: null
    });
  }

  const confidenceScore = confMatch ? parseFloat(confMatch[1]) : 0.85;

  return {
    answer,
    evidenceReferences,
    applicabilityStatus: applicabilityMatch ? applicabilityMatch[1] : 'APPLICABLE',
    uncertainty: {
      level: confidenceScore > 0.8 ? 'LOW' : 'MEDIUM',
      score: Number((1.0 - confidenceScore).toFixed(2)),
      reason: 'Recovered via heuristic extraction'
    },
    refusalReason: refusalMatch ? refusalMatch[1] : null
  };
}

// ============================================================================
// Enum Normalizers
// ============================================================================

/**
 * Safely normalizes applicability status to valid enum without crashing.
 */
export function normalizeApplicabilityStatus(val) {
  if (!val || typeof val !== 'string') return { status: 'UNKNOWN', normalized: true };
  const upper = val.trim().toUpperCase();

  if (APPLICABILITY_STATUSES.includes(upper)) {
    return { status: upper, normalized: false };
  }

  // Synonym mappings
  const SYNONYM_MAP = {
    'CURRENT': 'APPLICABLE',
    'APPROVED': 'APPLICABLE',
    'ACTIVE': 'APPLICABLE',
    'VALID': 'APPLICABLE',
    'EFFECTIVE': 'APPLICABLE',
    'DEPRECATED': 'SUPERSEDED',
    'OBSOLETE': 'SUPERSEDED',
    'OUTDATED': 'SUPERSEDED',
    'REPLACED': 'SUPERSEDED',
    'ARCHIVED': 'HISTORICAL',
    'LEGACY': 'HISTORICAL',
    'REFUSED': 'NOT_APPLICABLE',
    'INSUFFICIENT': 'NOT_APPLICABLE',
    'NONE': 'NOT_APPLICABLE',
    'N/A': 'NOT_APPLICABLE'
  };

  if (SYNONYM_MAP[upper]) {
    return { status: SYNONYM_MAP[upper], normalized: true, original: val };
  }

  return { status: 'UNKNOWN', normalized: true, original: val };
}

/**
 * Safely normalizes uncertainty to valid structure without crashing.
 */
export function normalizeUncertainty(val, confidenceFallback) {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    let score = Number(val.score);
    if (isNaN(score) || score < 0.0 || score > 1.0) {
      score = typeof confidenceFallback === 'number'
        ? Number(Math.max(0.0, Math.min(1.0, 1.0 - confidenceFallback)).toFixed(2))
        : 0.1;
    }

    let level = typeof val.level === 'string' ? val.level.trim().toUpperCase() : null;
    if (!UNCERTAINTY_LEVELS.includes(level)) {
      if (score >= 0.8) level = 'COMPLETE';
      else if (score >= 0.4) level = 'HIGH';
      else if (score >= 0.15) level = 'MEDIUM';
      else level = 'LOW';
    }

    return {
      level,
      score,
      reason: typeof val.reason === 'string' ? val.reason : null
    };
  }

  // Number passed directly
  if (typeof val === 'number' && !isNaN(val)) {
    const score = Math.max(0.0, Math.min(1.0, val));
    let level = 'LOW';
    if (score >= 0.8) level = 'COMPLETE';
    else if (score >= 0.4) level = 'HIGH';
    else if (score >= 0.15) level = 'MEDIUM';
    return { level, score, reason: null };
  }

  // Fallback from confidence score
  const conf = typeof confidenceFallback === 'number' ? confidenceFallback : 0.9;
  const score = Number(Math.max(0.0, Math.min(1.0, 1.0 - conf)).toFixed(2));
  return {
    level: score >= 0.8 ? 'COMPLETE' : (score >= 0.4 ? 'HIGH' : (score >= 0.15 ? 'MEDIUM' : 'LOW')),
    score,
    reason: null
  };
}

// ============================================================================
// Schema Validator & Field Normalizer
// ============================================================================

/**
 * Validates typed RAG response against schema.
 * Enforces anti-fabrication: Never fabricates evidence references when missing.
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
    const altAnswer = normalized.response || normalized.directAnswer || normalized.result || normalized.content || normalized.text;
    if (altAnswer && typeof altAnswer === 'string' && altAnswer.trim().length > 0) {
      normalized.answer = altAnswer.trim();
      warnings.push(`Recovered 'answer' from alternative key`);
    } else {
      errors.push("Missing or empty required field: 'answer'");
    }
  } else {
    normalized.answer = normalized.answer.trim();
  }

  // 2. Detect Refusal
  const lowerAnswer = (normalized.answer || '').toLowerCase();
  const isRefusalText =
    lowerAnswer.includes('could not find sufficient information') ||
    lowerAnswer.includes('insufficient information') ||
    lowerAnswer.includes('no matching airline document') ||
    lowerAnswer.includes('not enough information');

  let refusalReason = normalized.refusalReason || null;
  if (refusalReason && typeof refusalReason === 'string') {
    const upperRefusal = refusalReason.trim().toUpperCase();
    if (REFUSAL_REASONS.includes(upperRefusal)) {
      refusalReason = upperRefusal;
    } else {
      warnings.push(`Normalized unsupported refusalReason '${refusalReason}' to 'INSUFFICIENT_EVIDENCE'`);
      refusalReason = 'INSUFFICIENT_EVIDENCE';
    }
  } else if (isRefusalText) {
    refusalReason = 'INSUFFICIENT_EVIDENCE';
    warnings.push("Detected procedural refusal in answer text; set refusalReason to 'INSUFFICIENT_EVIDENCE'");
  }
  normalized.refusalReason = refusalReason;

  // 3. Validate & Normalize 'evidenceReferences' (Anti-Fabrication Rule)
  let evidenceReferences = [];

  if (Array.isArray(normalized.evidenceReferences)) {
    evidenceReferences = normalized.evidenceReferences.map((ref, idx) => {
      if (typeof ref === 'string') {
        warnings.push(`Normalized string reference to object: '${ref}'`);
        return {
          documentId: ref,
          title: 'Referenced Document',
          section: null,
          page: null,
          effectiveDate: null,
          status: 'APPROVED',
          quote: null
        };
      }
      if (ref && typeof ref === 'object') {
        const statusUpper = (ref.status || 'APPROVED').toString().toUpperCase();
        return {
          documentId: ref.documentId || `REF-${idx + 1}`,
          title: ref.title || 'Referenced Document',
          section: ref.section || null,
          page: typeof ref.page === 'number' ? ref.page : null,
          effectiveDate: ref.effectiveDate || null,
          status: DOCUMENT_STATUSES.includes(statusUpper) ? statusUpper : 'UNKNOWN',
          quote: ref.quote || null
        };
      }
      return null;
    }).filter(Boolean);
  } else if (normalized.source && typeof normalized.source === 'object') {
    // Migration from legacy 'source'
    const s = normalized.source;
    evidenceReferences.push({
      documentId: s.documentId || 'DOC-UNKNOWN',
      title: s.title || 'Referenced Document',
      section: s.section || null,
      page: s.page || null,
      effectiveDate: s.effectiveDate || null,
      status: (s.status || 'APPROVED').toUpperCase(),
      quote: s.quote || null
    });
    warnings.push("Migrated legacy 'source' to 'evidenceReferences' array");
  } else if (Array.isArray(normalized.sources)) {
    // Migration from legacy 'sources' array
    evidenceReferences = normalized.sources.map(s => (typeof s === 'string' ? {
      documentId: s,
      title: 'Referenced Document',
      status: 'APPROVED'
    } : s));
    warnings.push("Migrated legacy 'sources' array to 'evidenceReferences'");
  }

  // ANTI-FABRICATION CHECK:
  // If evidence is empty and this is NOT a refusal, flag a warning but DO NOT invent fake documents.
  if (evidenceReferences.length === 0 && !refusalReason) {
    warnings.push("No evidence references provided with positive answer. Grounding unverifiable.");
  }
  normalized.evidenceReferences = evidenceReferences;

  // 4. Validate & Normalize 'applicabilityStatus'
  const appNorm = normalizeApplicabilityStatus(
    normalized.applicabilityStatus || (refusalReason ? 'NOT_APPLICABLE' : 'APPLICABLE')
  );
  if (appNorm.normalized) {
    warnings.push(`Normalized applicabilityStatus '${appNorm.original || 'undefined'}' to '${appNorm.status}'`);
  }
  normalized.applicabilityStatus = appNorm.status;

  // 5. Validate & Normalize 'uncertainty'
  normalized.uncertainty = normalizeUncertainty(normalized.uncertainty, normalized.confidence);

  // 6. Populate Legacy Compatibility Fields
  normalized.source = evidenceReferences[0] || null;
  normalized.sources = evidenceReferences;
  normalized.confidence = Number((1.0 - normalized.uncertainty.score).toFixed(2));
  normalized.isGrounded = Boolean(evidenceReferences.length > 0 && refusalReason === null);
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

// ============================================================================
// End-to-End Processor
// ============================================================================

/**
 * End-to-end processing pipeline: Parse -> Validate -> Safe Normalized Object
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

export default {
  APPLICABILITY_STATUSES,
  UNCERTAINTY_LEVELS,
  REFUSAL_REASONS,
  DOCUMENT_STATUSES,
  STRUCTURED_RAG_SCHEMA,
  STRUCTURED_SYSTEM_PROMPT,
  parseStructuredOutput,
  validateStructuredOutput,
  normalizeApplicabilityStatus,
  normalizeUncertainty,
  processLlmOutput
};
