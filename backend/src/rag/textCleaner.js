/**
 * ============================================================================
 * Milestone 3.20: Text Extraction & Cleaning Pipeline
 * Airline Procedure Intelligence System
 * ============================================================================
 */

// Default safety keywords that prevent a line from ever being stripped as boilerplate
export const DEFAULT_SAFETY_KEYWORDS = Object.freeze([
  'WARNING',
  'CAUTION',
  'NOTE',
  'DANGER',
  'CRITICAL',
  'MANDATORY',
  'IMMEDIATE',
  'EMERGENCY',
  'RESTRICTION',
  'ATTENTION',
  'SAFETY DIRECTIVE',
  'AIRWORTHINESS',
  'GO-AROUND',
  'ABORT',
  'STERILE COCKPIT'
]);

// Default procedural callout & operational verbs indicating flight instructions
export const DEFAULT_PROCEDURAL_MARKERS = Object.freeze([
  'SET',
  'VERIFY',
  'EXTEND',
  'RETRACT',
  'CLOSE',
  'OPEN',
  'DISENGAGE',
  'ENGAGE',
  'CALL',
  'MONITOR',
  'CHECK',
  'CONFIRM',
  'MAINTAIN',
  'DESCEND',
  'CLIMB',
  'HOLD',
  'CROSS',
  'ANNOUNCE',
  'INITIATE',
  'TERMINATE',
  'ESTABLISH',
  'TRANSMIT',
  'SELECT'
]);

// Aeronautical units and parameter tokens indicating operational flight constraints
export const FLIGHT_PARAMETER_TOKENS = Object.freeze([
  /\b\d+\s*(?:ft|feet|msl|agl|fl|kias|kt|knots|mach|lbs|kg|psi|c|f)\b/i,
  /\bfl\s*\d{2,3}\b/i,
  /\bvmo\b/i,
  /\bmmo\b/i,
  /\bto\/ga\b/i,
  /\bdetent\b/i,
  /\bthrust\s+levers\b/i,
  /\baltimeter\b/i
]);

// Built-in standard repetitive document boilerplate patterns
export const DEFAULT_BOILERPLATE_PATTERNS = Object.freeze([
  // Page number patterns: "Page 1 of 5", "- Page 12 -", "Page 1", "P. 14 / 85", "[Page 3]"
  /^\s*(?:\[|\()?page\s*\d+(?:\s*(?:of|\/|-)\s*\d+)?(?:\)|\])?\s*$/i,
  /^\s*-\s*\d+\s*-\s*$/,
  /^\s*\d+\s*\/\s*\d+\s*$/,

  // Confidentiality, proprietary, and copyright notices
  /^\s*(?:company\s+)?confidential(?:\s*-\s*for\s+internal\s+use\s+only)?\s*$/i,
  /^\s*proprietary\s+(?:and\s+confidential|information)\s*$/i,
  /^\s*(?:all\s+rights\s+reserved|unauthorized\s+distribution\s+prohibited)\.?\s*$/i,
  /^\s*copyright\s*(?:©|\(c\))\s*\d{4}.*$/i,

  // Export / print / generation timestamps
  /^\s*(?:generated|printed|exported)\s+(?:on|at)\s*:\s*\d{4}[-/.]\d{2}[-/.]\d{2}.*$/i,
  /^\s*(?:system\s+timestamp|auto-generated\s+document)\b.*$/i
]);

/**
 * Normalizes text encoding and repairs non-standard Unicode artifacts.
 *
 * @param {string} text - Raw input text.
 * @returns {{ text: string, anomaliesRepaired: number }}
 */
export function normalizeEncoding(text) {
  if (!text || typeof text !== 'string') {
    return { text: '', anomaliesRepaired: 0 };
  }

  let anomaliesRepaired = 0;
  let normalized = text;

  // 1. Unicode NFC Canonical Decomposition/Composition
  const beforeNFC = normalized;
  normalized = normalized.normalize('NFC');
  if (normalized !== beforeNFC) {
    anomaliesRepaired++;
  }

  // 2. Remove null bytes and non-printable control characters (preserving \n, \r, \t)
  const nullMatches = (normalized.match(/[\x00\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
  if (nullMatches > 0) {
    anomaliesRepaired += nullMatches;
    normalized = normalized.replace(/[\x00\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  // 3. Normalize zero-width spaces and Byte Order Marks
  const zwMatches = (normalized.match(/[\u200B-\u200D\uFEFF]/g) || []).length;
  if (zwMatches > 0) {
    anomaliesRepaired += zwMatches;
    normalized = normalized.replace(/[\u200B-\u200D\uFEFF]/g, '');
  }

  // 4. Normalize non-breaking and unusual spaces (\u00A0, \u202F, \u2007, \u3000) to standard space
  const nbspMatches = (normalized.match(/[\u00A0\u202F\u2007\u3000]/g) || []).length;
  if (nbspMatches > 0) {
    anomaliesRepaired += nbspMatches;
    normalized = normalized.replace(/[\u00A0\u202F\u2007\u3000]/g, ' ');
  }

  // 5. Normalize smart/curly double quotes: “ ” „ « » -> "
  const dQuoteMatches = (normalized.match(/[“”„«»]/g) || []).length;
  if (dQuoteMatches > 0) {
    anomaliesRepaired += dQuoteMatches;
    normalized = normalized.replace(/[“”„«»]/g, '"');
  }

  // 6. Normalize smart/curly single quotes and accents: ‘ ’ ‚ ‛ ` -> '
  const sQuoteMatches = (normalized.match(/[‘’‚‛`]/g) || []).length;
  if (sQuoteMatches > 0) {
    anomaliesRepaired += sQuoteMatches;
    normalized = normalized.replace(/[‘’‚‛`]/g, "'");
  }

  // 7. Normalize em/en dashes and minus signs: – — − ― -> -
  const dashMatches = (normalized.match(/[–—−―]/g) || []).length;
  if (dashMatches > 0) {
    anomaliesRepaired += dashMatches;
    normalized = normalized.replace(/[–—−―]/g, '-');
  }

  return { text: normalized, anomaliesRepaired };
}

/**
 * Checks if a candidate line is part of a markdown table or column-aligned table.
 *
 * @param {string} line - Line text.
 * @returns {boolean}
 */
export function isTableLine(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();

  // Pipe table row: | col1 | col2 | or col1 | col2 | col3
  if (/^\|?.+\|.+\|?$/.test(trimmed)) {
    return true;
  }

  // Pipe table separator: |---|---| or |:---:|---:|
  if (/^\|?\s*[-:]+[-| :]+\s*\|?$/.test(trimmed)) {
    return true;
  }

  // Tab-delimited row (2+ tabs)
  if ((line.match(/\t/g) || []).length >= 2) {
    return true;
  }

  // Multi-column fixed width: 3+ words separated by 2+ consecutive spaces
  if (/^[\w#.-]+(?:\s{2,}[\w#.-]+){2,}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Checks if a line contains a procedural numbered or lettered step.
 * e.g., "1. Oxygen Masks: ON", "1.1 Altitude Selector", "a. Check fuel", "Step 1:"
 *
 * @param {string} line - Line text.
 * @returns {boolean}
 */
export function isProceduralStep(line) {
  if (!line || typeof line !== 'string') return false;
  const trimmed = line.trim();

  // Numbered steps: "1.", "1.1", "1.1.2.", "(1)", "1)", "1-" followed by content
  if (/^(?:\(?\d+\.|\(?\d+(?:\.\d+)+[.)]?|\(?\d+\)|\d+[-:])\s+\S/.test(trimmed)) {
    return true;
  }

  // Explicit step keyword: "Step 1:", "STEP 2 -"
  if (/^step\s+\d+[:.-]?\s+\S/i.test(trimmed)) {
    return true;
  }

  // Lettered sub-steps: "a.", "b.", "(a)", "[b]", "a) " followed by content
  if (/^(?:\(?[a-zA-Z]\)|[a-zA-Z][.)])\s+\S/.test(trimmed)) {
    return true;
  }

  // Roman numeral steps: "i.", "ii.", "iv.", "(i)" followed by content
  if (/^(?:\(?[ivxlcdm]+\)|[ivxlcdm]+[.)])\s+\S/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Checks if a line is a safety-critical procedure, warning, callout, or operational parameter.
 * Used by the SAFETY INVARIANT to prevent accidental deletion of critical instructions.
 *
 * @param {string} line - Line text.
 * @param {Object} [options] - Keyword configuration.
 * @returns {{ isCritical: boolean, reason: string | null }}
 */
export function isSafetyCritical(line, options = {}) {
  if (!line || typeof line !== 'string') {
    return { isCritical: false, reason: null };
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return { isCritical: false, reason: null };
  }

  const safetyKeywords = options.safetyKeywords || DEFAULT_SAFETY_KEYWORDS;
  const upper = trimmed.toUpperCase();

  // 1. Check for safety warning keywords
  for (const kw of safetyKeywords) {
    // Match keyword boundary
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    if (regex.test(upper)) {
      return {
        isCritical: true,
        reason: `Matched safety keyword: "${kw}"`
      };
    }
  }

  // 2. Check for numbered or lettered procedure steps
  if (isProceduralStep(trimmed)) {
    return {
      isCritical: true,
      reason: 'Contains numbered/lettered procedure step'
    };
  }

  // 3. Check for procedural operational verbs (e.g., "SET", "VERIFY", "EXTEND")
  const words = trimmed.split(/\s+/);
  if (words.length > 0) {
    const firstWord = words[0].toUpperCase().replace(/[^A-Z]/g, '');
    if (DEFAULT_PROCEDURAL_MARKERS.includes(firstWord)) {
      return {
        isCritical: true,
        reason: `Starts with operational command verb: "${firstWord}"`
      };
    }
  }

  // 4. Check for flight parameters and constraints
  for (const paramRegex of FLIGHT_PARAMETER_TOKENS) {
    if (paramRegex.test(trimmed)) {
      return {
        isCritical: true,
        reason: 'Contains aeronautical flight parameters or altitude/speed limits'
      };
    }
  }

  return { isCritical: false, reason: null };
}

/**
 * Normalizes whitespace across the document while preserving structural integrity:
 * - Converts CRLF/CR to LF
 * - Trims trailing whitespace per line
 * - Preserves table column spacing
 * - Collapses redundant non-table spaces
 * - Caps excessive consecutive blank lines to 2
 *
 * @param {string} text - Input text.
 * @param {Object} [options] - Whitespace options.
 * @returns {string}
 */
export function normalizeWhitespace(text, options = {}) {
  if (!text || typeof text !== 'string') return '';

  // 1. Normalize line endings to standard LF
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 2. Process line by line
  const lines = normalized.split('\n');
  const processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Preserve table formatting
    if (isTableLine(line)) {
      // Trim right only, preserving internal column spacing and indentation
      processedLines.push(line.trimEnd());
      continue;
    }

    // Preserve code blocks or markdown blockquotes if requested
    if (line.startsWith('    ') || line.startsWith('\t') || line.startsWith('>')) {
      processedLines.push(line.trimEnd());
      continue;
    }

    // Collapse multiple horizontal spaces/tabs on non-table lines
    const collapsed = line.replace(/[ \t]{2,}/g, ' ').trimEnd();
    processedLines.push(collapsed);
  }

  normalized = processedLines.join('\n');

  // 3. Collapse excessive consecutive blank lines (limit to max 2 consecutive blank lines)
  normalized = normalized.replace(/\n{4,}/g, '\n\n\n');

  // 4. Final trim of document start and end
  return normalized.trim();
}

/**
 * Removes repetitive headers, footers, and configured boilerplate while enforcing
 * the SAFETY INVARIANT (never delete a line containing a procedure, warning, or flight parameter).
 *
 * @param {string} text - Cleaned text.
 * @param {Object} [options] - Removal options.
 * @returns {{ text: string, removedCount: number, safetyPreservedCount: number, warnings: Array }}
 */
export function removeBoilerplate(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return { text: '', removedCount: 0, safetyPreservedCount: 0, warnings: [] };
  }

  const customPatterns = options.boilerplatePatterns || [];
  const patterns = [...DEFAULT_BOILERPLATE_PATTERNS, ...customPatterns];
  const lines = text.split('\n');
  const retainedLines = [];
  const warnings = [];

  let removedCount = 0;
  let safetyPreservedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty lines are preserved
    if (!trimmed) {
      retainedLines.push(line);
      continue;
    }

    // Test if line matches any boilerplate pattern
    let isBoilerplateCandidate = false;
    let matchedPatternDesc = '';

    for (const pattern of patterns) {
      if (pattern instanceof RegExp && pattern.test(trimmed)) {
        isBoilerplateCandidate = true;
        matchedPatternDesc = pattern.toString();
        break;
      } else if (typeof pattern === 'string' && trimmed.toLowerCase().includes(pattern.toLowerCase())) {
        isBoilerplateCandidate = true;
        matchedPatternDesc = `string "${pattern}"`;
        break;
      }
    }

    if (isBoilerplateCandidate) {
      // SAFETY INVARIANT CHECK:
      // Avoid deleting text solely because it resembles a header or footer
      // if doing so could remove a procedure or safety warning!
      const safetyCheck = isSafetyCritical(trimmed, options);

      if (safetyCheck.isCritical) {
        // PRESERVE the line and log informative warning
        safetyPreservedCount++;
        retainedLines.push(line);
        warnings.push({
          code: 'HEADER_PRESERVED_SAFETY',
          message: `Preserved candidate boilerplate line because it contains safety or procedure content (${safetyCheck.reason}): "${trimmed}"`,
          severity: 'INFO',
          lineIndex: i + 1
        });
      } else {
        // Safe to remove
        removedCount++;
      }
    } else {
      retainedLines.push(line);
    }
  }

  // Clean up any double blank lines introduced by removed lines
  let resultText = retainedLines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim();

  return {
    text: resultText,
    removedCount,
    safetyPreservedCount,
    warnings
  };
}

/**
 * Analyzes document text to detect headings, numbered steps, warnings, and tables.
 *
 * @param {string} text - Cleaned text.
 * @returns {Object} Structural elements breakdown.
 */
export function detectStructure(text) {
  if (!text || typeof text !== 'string') {
    return { headings: [], steps: [], warnings: [], tables: [] };
  }

  const lines = text.split('\n');
  const headings = [];
  const steps = [];
  const warnings = [];
  const tables = [];

  let currentTable = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (currentTable) {
        tables.push(currentTable);
        currentTable = null;
      }
      continue;
    }

    const isWarningLine = /^(?:[*_#>\s]*)(?:WARNING|CAUTION|NOTE|DANGER|MANDATORY)\b/i.test(line);

    // 1. Detect Headings
    if (/^#{1,6}\s+.+$/.test(line)) {
      headings.push({ level: line.match(/^#+/)[0].length, title: line.replace(/^#+\s*/, '') });
    } else if (
      !isWarningLine &&
      /^[A-Z0-9\s:.-]{5,}$/.test(line) &&
      line.length < 80 &&
      !line.includes('.') &&
      wordsCount(line) < 10
    ) {
      // Uppercase procedure heading
      headings.push({ level: 2, title: line });
    }

    // 2. Detect Procedural Steps
    if (isProceduralStep(line)) {
      steps.push(line);
    }

    // 3. Detect Warnings / Cautions / Notes (supporting markdown bolding, prefixes, blockquotes)
    if (isWarningLine) {
      warnings.push(line);
    }

    // 4. Detect Tables
    if (isTableLine(line)) {
      if (!currentTable) {
        currentTable = { startLine: i + 1, rowCount: 1, sample: line };
      } else {
        currentTable.rowCount++;
      }
    } else if (currentTable) {
      tables.push(currentTable);
      currentTable = null;
    }
  }

  if (currentTable) {
    tables.push(currentTable);
  }

  return { headings, steps, warnings, tables };
}

function wordsCount(str) {
  return str.split(/\s+/).filter(Boolean).length;
}

/**
 * Computes extraction quality metrics, issue diagnostics, and overall score.
 *
 * @param {string} cleanedText - Resulting text.
 * @param {string} rawText - Original raw text.
 * @param {Object} context - Cleaning context (anomaliesRepaired, boilerplateRemoved, etc.).
 * @returns {Object} Quality metrics report.
 */
export function extractQualityMetrics(cleanedText, rawText, context = {}) {
  const rawLength = (rawText || '').length;
  const cleanedLength = (cleanedText || '').length;
  const reductionRatio = rawLength > 0 ? Number(((rawLength - cleanedLength) / rawLength).toFixed(4)) : 0;

  const lines = cleanedText ? cleanedText.split('\n') : [];
  const paragraphs = cleanedText ? cleanedText.split(/\n\s*\n/).filter(p => p.trim().length > 0) : [];
  const words = cleanedText ? cleanedText.split(/\s+/).filter(Boolean) : [];

  const structure = detectStructure(cleanedText);
  const issues = [];

  // Diagnostic issue checks
  if (cleanedLength === 0) {
    issues.push('EMPTY_TEXT: Cleaned text contains 0 characters.');
  } else if (cleanedLength < 80) {
    issues.push('SUSPICIOUSLY_SHORT: Text contains fewer than 80 characters.');
  }

  if (reductionRatio > 0.6) {
    issues.push(`HIGH_REDUCTION_RATIO: More than 60% (${(reductionRatio * 100).toFixed(1)}%) of original text was stripped.`);
  }

  if (structure.steps.length === 0 && structure.headings.length === 0 && structure.warnings.length === 0) {
    issues.push('LACKS_PROCEDURAL_STRUCTURE: No headings, numbered steps, or safety warnings detected.');
  }

  // Calculate quality score (0 - 100)
  let qualityScore = 100;

  if (cleanedLength === 0) {
    qualityScore = 0;
  } else {
    // Deduct for suspicious shortness
    if (cleanedLength < 80) qualityScore -= 30;
    // Deduct for excessive boilerplate reduction
    if (reductionRatio > 0.7) qualityScore -= 20;
    else if (reductionRatio > 0.5) qualityScore -= 10;
    // Bonus / preservation for procedural structure
    if (structure.steps.length > 0) qualityScore = Math.min(100, qualityScore + 5);
    if (structure.warnings.length > 0) qualityScore = Math.min(100, qualityScore + 5);
    if (structure.headings.length > 0) qualityScore = Math.min(100, qualityScore + 5);
    // Deduct if completely devoid of structure
    if (issues.includes('LACKS_PROCEDURAL_STRUCTURE')) qualityScore -= 15;
  }

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return {
    characterCount: cleanedLength,
    wordCount: words.length,
    lineCount: lines.length,
    paragraphCount: paragraphs.length,
    headingCount: structure.headings.length,
    numberedStepCount: structure.steps.length,
    warningCount: structure.warnings.length,
    tableCount: structure.tables.length,
    boilerplateLinesRemoved: context.boilerplateRemoved || 0,
    safetyLinesPreserved: context.safetyPreserved || 0,
    encodingAnomaliesRepaired: context.anomaliesRepaired || 0,
    reductionRatio,
    qualityScore,
    qualityIssues: issues
  };
}

/**
 * Primary deterministic text cleaning pipeline function.
 *
 * @param {string} rawText - Input raw text.
 * @param {Object} [options] - Pipeline options.
 * @param {Array<RegExp|string>} [options.boilerplatePatterns] - Custom repetitive boilerplate patterns.
 * @param {Array<string>} [options.safetyKeywords] - Additional safety keywords to preserve.
 * @param {boolean} [options.removeBoilerplate=true] - Whether to strip safe repetitive boilerplate.
 * @returns {Object} Standardized cleaning result with text, metrics, structure, and warnings.
 */
export function cleanText(rawText, options = {}) {
  const warnings = [];
  const raw = rawText || '';

  // Step 1: Normalize Encoding
  const { text: encNormalized, anomaliesRepaired } = normalizeEncoding(raw);
  if (anomaliesRepaired > 0) {
    warnings.push({
      code: 'ENCODING_REPAIRED',
      message: `Repaired ${anomaliesRepaired} encoding anomalies (smart quotes, dashes, non-breaking spaces, or control characters).`,
      severity: 'INFO'
    });
  }

  // Step 2: Normalize Whitespace and Line Structure
  const wsNormalized = normalizeWhitespace(encNormalized, options);

  // Step 3: Remove Boilerplate with Safety Guard
  let cleanedText = wsNormalized;
  let boilerplateRemoved = 0;
  let safetyPreserved = 0;

  if (options.removeBoilerplate !== false) {
    const bpResult = removeBoilerplate(wsNormalized, options);
    cleanedText = bpResult.text;
    boilerplateRemoved = bpResult.removedCount;
    safetyPreserved = bpResult.safetyPreservedCount;
    warnings.push(...bpResult.warnings);
  }

  // Step 4: Detect Structure & Quality Metrics
  const structure = detectStructure(cleanedText);
  const qualityMetrics = extractQualityMetrics(cleanedText, raw, {
    anomaliesRepaired,
    boilerplateRemoved,
    safetyPreserved
  });

  // Step 5: Check for potential quality warning flags
  if (qualityMetrics.qualityIssues.length > 0) {
    for (const issue of qualityMetrics.qualityIssues) {
      warnings.push({
        code: issue.split(':')[0],
        message: issue,
        severity: qualityMetrics.characterCount === 0 ? 'ERROR' : 'WARNING'
      });
    }
  }

  return {
    cleanedText,
    rawLength: raw.length,
    cleanedLength: cleanedText.length,
    reductionRatio: qualityMetrics.reductionRatio,
    warnings,
    qualityMetrics,
    structure
  };
}

/**
 * Deterministic Text Cleaning Pipeline Class
 * Pluggable architecture allowing pipeline composition and reusable instances.
 */
export class TextCleaningPipeline {
  constructor(defaultOptions = {}) {
    this.options = { ...defaultOptions };
    this.customSteps = [];
  }

  /**
   * Register a custom middleware cleaning step.
   * @param {Function} stepFn - fn(text, context) => text
   */
  use(stepFn) {
    if (typeof stepFn === 'function') {
      this.customSteps.push(stepFn);
    }
    return this;
  }

  /**
   * Executes the cleaning pipeline.
   * @param {string} rawText - Input raw text.
   * @param {Object} [overrideOptions] - Options overriding constructor defaults.
   * @returns {Object} Standardized cleaning result.
   */
  process(rawText, overrideOptions = {}) {
    const mergedOptions = { ...this.options, ...overrideOptions };
    let result = cleanText(rawText, mergedOptions);

    // Apply any custom post-processing steps
    if (this.customSteps.length > 0) {
      let text = result.cleanedText;
      for (const step of this.customSteps) {
        text = step(text, result);
      }
      result.cleanedText = text;
      result.cleanedLength = text.length;
      result.qualityMetrics = extractQualityMetrics(text, rawText, {
        anomaliesRepaired: result.qualityMetrics.encodingAnomaliesRepaired,
        boilerplateRemoved: result.qualityMetrics.boilerplateLinesRemoved,
        safetyPreserved: result.qualityMetrics.safetyLinesPreserved
      });
    }

    return result;
  }
}
