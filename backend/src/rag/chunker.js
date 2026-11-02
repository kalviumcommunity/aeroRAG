/**
 * ============================================================================
 * Milestone 3.21: Document Chunking Strategies
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import { estimateTokenCountSync } from './tokenContextManager.js';
import { isProceduralStep, isSafetyCritical, isTableLine } from './textCleaner.js';
import {
  DOCUMENT_TYPES,
  APPLICABILITY_STATUSES,
  VERIFICATION_STATUSES,
  UNCERTAINTY_CODES,
  validateDocumentMetadata,
  formatChunkCitation,
  propagateMetadataToChunks,
  resolveDocumentRelationships
} from './metadataManager.js';

export {
  DOCUMENT_TYPES,
  APPLICABILITY_STATUSES,
  VERIFICATION_STATUSES,
  UNCERTAINTY_CODES,
  validateDocumentMetadata,
  formatChunkCitation,
  propagateMetadataToChunks,
  resolveDocumentRelationships
};

export const CHUNK_STRATEGIES = Object.freeze({
  FIXED_SIZE: 'fixed_size',
  HEADING_AWARE: 'heading_aware',
  PROCEDURE_AWARE: 'procedure_aware'
});

export const DEFAULT_CHUNK_CONFIG = Object.freeze({
  strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
  maxChunkSize: 400,        // Max size in unit (default: tokens)
  minChunkSize: 50,         // Min size to prevent tiny orphan fragments
  overlap: 40,              // Overlap size for sliding transitions
  unit: 'tokens',           // 'tokens' | 'characters' | 'words'
  preserveHeadings: true,   // Track and include heading hierarchy
  preserveProcedures: true, // Keep numbered checklists atomic wherever possible
  includeHeadingBreadcrumbs: true // Prepend "[Parent > Section]" breadcrumbs
});

/**
 * Normalizes and validates chunking configuration options.
 * Enforces token-aware limits and bounds overlap to strictly prevent runaway chunk growth.
 *
 * @param {Object} [options={}] - Input options.
 * @returns {Object} Normalized, validated options.
 */
export function normalizeChunkingOptions(options = {}) {
  const maxChunkSize = Math.max(10, Number(options.maxChunkSize) || DEFAULT_CHUNK_CONFIG.maxChunkSize);
  const minChunkSize = Math.max(1, Math.min(Number(options.minChunkSize) || DEFAULT_CHUNK_CONFIG.minChunkSize, Math.floor(maxChunkSize / 2)));

  // Bounded overlap: strictly between 0 and floor(maxChunkSize / 2)
  // Prevents runaway chunk growth where overlap exceeds remaining capacity
  const rawOverlap = options.overlap !== undefined ? Number(options.overlap) : DEFAULT_CHUNK_CONFIG.overlap;
  const maxSafeOverlap = Math.floor(maxChunkSize / 2);
  const overlap = Math.max(0, Math.min(isNaN(rawOverlap) ? DEFAULT_CHUNK_CONFIG.overlap : rawOverlap, maxSafeOverlap));

  return {
    ...DEFAULT_CHUNK_CONFIG,
    ...options,
    maxChunkSize,
    minChunkSize,
    overlap,
    unit: options.unit || DEFAULT_CHUNK_CONFIG.unit,
    strategy: options.strategy || DEFAULT_CHUNK_CONFIG.strategy
  };
}

/**
 * Measures the size of text according to the configured unit ('tokens', 'characters', 'words').
 *
 * @param {string} text - Input text.
 * @param {string} [unit='tokens'] - Unit of measurement.
 * @returns {number} Measured size.
 */
export function measureSize(text, unit = 'tokens') {
  if (!text || typeof text !== 'string') return 0;
  switch (unit) {
    case 'characters':
    case 'chars':
      return text.length;
    case 'words':
      return text.trim().split(/\s+/).filter(Boolean).length;
    case 'tokens':
    default:
      return estimateTokenCountSync(text);
  }
}

/**
 * Extracts headings from text or lines.
 */
function parseHeadingLine(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();

  // Markdown heading: "# Heading", "## Subheading"
  const mdMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (mdMatch) {
    return { level: mdMatch[1].length, title: mdMatch[2].trim() };
  }

  // All-caps aviation procedure title: e.g. "EMERGENCY DESCENT CHECKLIST"
  if (/^[A-Z0-9\s:.-]{5,}$/.test(trimmed) && trimmed.length < 80 && !trimmed.includes('.') && trimmed.split(/\s+/).length < 10) {
    return { level: 2, title: trimmed };
  }

  return null;
}

/**
 * Constructs a heading breadcrumb string from a hierarchy stack.
 * e.g., "[Quick Reference Handbook > Emergency Descent > Announce & Initiate]"
 */
export function formatHeadingBreadcrumb(headings) {
  if (!headings || headings.length === 0) return '';
  return `[${headings.join(' > ')}]\n\n`;
}

/**
 * Creates a standardized chunk DTO.
 */
function createChunkRecord({
  text,
  chunkIndex,
  startChar,
  endChar,
  strategy,
  headings = [],
  sectionTitle = null,
  isSplitProcedure = false
}) {
  const cleanText = text.trim();
  const tokenCount = estimateTokenCountSync(cleanText);
  const charCount = cleanText.length;
  const wordCount = cleanText.split(/\s+/).filter(Boolean).length;

  // Detect steps and warnings in this chunk
  const lines = cleanText.split('\n');
  const procedureSteps = [];
  const warnings = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (isProceduralStep(trimmed)) {
      procedureSteps.push(trimmed);
    }
    const safety = isSafetyCritical(trimmed);
    if (safety.isCritical && (trimmed.toUpperCase().includes('WARNING') || trimmed.toUpperCase().includes('CAUTION') || trimmed.toUpperCase().includes('NOTE'))) {
      warnings.push(trimmed);
    }
  }

  return {
    id: `chunk_${chunkIndex}`,
    text: cleanText,
    chunkIndex,
    startChar: Math.max(0, startChar),
    endChar: Math.max(startChar, endChar),
    tokenCount,
    charCount,
    wordCount,
    metadata: {
      strategy,
      headings: [...headings],
      sectionTitle: sectionTitle || (headings.length > 0 ? headings[headings.length - 1] : null),
      containsProcedure: procedureSteps.length > 0,
      containsWarning: warnings.length > 0,
      procedureSteps: procedureSteps.length > 0 ? procedureSteps : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      isSplitProcedure: isSplitProcedure || false
    }
  };
}

/**
 * ============================================================================
 * Strategy 1: Fixed-Size Token/Character-Bounded Sliding Window
 * ============================================================================
 */
export function splitFixedSize(text, rawOptions = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  const options = normalizeChunkingOptions(rawOptions);
  const { maxChunkSize, overlap, unit } = options;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // If entire text fits in one chunk, return immediately
  const totalSize = measureSize(text, unit);
  if (totalSize <= maxChunkSize) {
    return [createChunkRecord({
      text,
      chunkIndex: 0,
      startChar: 0,
      endChar: text.length,
      strategy: CHUNK_STRATEGIES.FIXED_SIZE
    })];
  }

  const chunks = [];
  let currentChunkIndex = 0;
  let wordIndex = 0;

  while (wordIndex < words.length) {
    let currentWords = [];
    let currentSize = 0;
    const startIndex = wordIndex;

    while (wordIndex < words.length) {
      const word = words[wordIndex];
      const testChunk = [...currentWords, word].join(' ');
      const testSize = measureSize(testChunk, unit);

      if (testSize > maxChunkSize && currentWords.length > 0) {
        break;
      }

      currentWords.push(word);
      currentSize = testSize;
      wordIndex++;
    }

    if (currentWords.length === 0 && wordIndex < words.length) {
      // Single word exceeds maxChunkSize, take it anyway
      currentWords.push(words[wordIndex]);
      wordIndex++;
    }

    const chunkText = currentWords.join(' ');
    // Approximate start/end characters
    const startChar = text.indexOf(currentWords[0]);
    const endChar = startChar + chunkText.length;

    chunks.push(createChunkRecord({
      text: chunkText,
      chunkIndex: currentChunkIndex,
      startChar: startChar >= 0 ? startChar : 0,
      endChar: endChar >= 0 ? endChar : chunkText.length,
      strategy: CHUNK_STRATEGIES.FIXED_SIZE
    }));

    currentChunkIndex++;

    if (wordIndex >= words.length) break;

    // Apply overlap by rolling back wordIndex
    if (overlap > 0) {
      let overlapCount = 0;
      let rollbackWords = 0;
      for (let i = currentWords.length - 1; i >= 0; i--) {
        const size = measureSize(currentWords.slice(i).join(' '), unit);
        if (size <= overlap) {
          rollbackWords = currentWords.length - i;
        } else {
          break;
        }
      }
      // Guarantee forward progress by at least 1 word
      const stepForward = Math.max(1, currentWords.length - rollbackWords);
      wordIndex = startIndex + stepForward;
    }
  }

  return chunks;
}

/**
 * ============================================================================
 * Strategy 2: Heading-Aware Hierarchical Chunking
 * ============================================================================
 */
export function splitHeadingAware(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  const maxChunkSize = options.maxChunkSize || DEFAULT_CHUNK_CONFIG.maxChunkSize;
  const minChunkSize = options.minChunkSize || DEFAULT_CHUNK_CONFIG.minChunkSize;
  const unit = options.unit || DEFAULT_CHUNK_CONFIG.unit;
  const includeBreadcrumbs = options.includeHeadingBreadcrumbs !== false;

  const lines = text.split('\n');
  const sections = [];

  let currentHeadingStack = [];
  let currentLines = [];
  let currentStartChar = 0;
  let charTracker = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = parseHeadingLine(line);

    if (heading) {
      // Flush preceding section if it has content
      if (currentLines.length > 0) {
        sections.push({
          headings: [...currentHeadingStack],
          lines: [...currentLines],
          startChar: currentStartChar,
          endChar: charTracker - 1
        });
        currentLines = [];
      }

      // Update heading stack according to hierarchy level
      const level = heading.level;
      currentHeadingStack = currentHeadingStack.slice(0, level - 1);
      currentHeadingStack[level - 1] = heading.title;
      currentHeadingStack = currentHeadingStack.filter(Boolean);

      currentStartChar = charTracker;
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }

    charTracker += line.length + 1; // +1 for newline
  }

  if (currentLines.length > 0) {
    sections.push({
      headings: [...currentHeadingStack],
      lines: [...currentLines],
      startChar: currentStartChar,
      endChar: charTracker
    });
  }

  // Convert sections into chunks, sub-splitting oversized sections
  const chunks = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const rawSectionText = section.lines.join('\n').trim();
    if (!rawSectionText) continue;

    const breadcrumb = (includeBreadcrumbs && section.headings.length > 0)
      ? formatHeadingBreadcrumb(section.headings)
      : '';
    const sectionText = breadcrumb + rawSectionText;
    const sectionSize = measureSize(sectionText, unit);

    if (sectionSize <= maxChunkSize) {
      // Fits comfortably within maxChunkSize
      chunks.push(createChunkRecord({
        text: sectionText,
        chunkIndex: chunkIndex++,
        startChar: section.startChar,
        endChar: section.endChar,
        strategy: CHUNK_STRATEGIES.HEADING_AWARE,
        headings: section.headings,
        sectionTitle: section.headings[section.headings.length - 1] || null
      }));
    } else {
      // Section exceeds maxChunkSize; sub-split by paragraphs or sentences
      const subChunks = subSplitSection(section.lines, {
        ...options,
        headings: section.headings,
        baseStartChar: section.startChar
      });

      for (const sc of subChunks) {
        chunks.push(createChunkRecord({
          text: (includeBreadcrumbs && section.headings.length > 0) ? `${breadcrumb}${sc.text}` : sc.text,
          chunkIndex: chunkIndex++,
          startChar: sc.startChar,
          endChar: sc.endChar,
          strategy: CHUNK_STRATEGIES.HEADING_AWARE,
          headings: section.headings,
          sectionTitle: section.headings[section.headings.length - 1] || null
        }));
      }
    }
  }

  return chunks;
}

/**
 * Helper to sub-split an oversized section across paragraphs while preserving boundaries.
 */
function subSplitSection(lines, options) {
  const maxChunkSize = options.maxChunkSize || DEFAULT_CHUNK_CONFIG.maxChunkSize;
  const unit = options.unit || DEFAULT_CHUNK_CONFIG.unit;
  const baseStartChar = options.baseStartChar || 0;

  const paragraphs = lines.join('\n').split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const result = [];

  let currentParaBatch = [];
  let currentSize = 0;
  let batchStart = baseStartChar;

  for (const para of paragraphs) {
    const paraSize = measureSize(para, unit);

    if (currentSize + paraSize > maxChunkSize && currentParaBatch.length > 0) {
      const batchText = currentParaBatch.join('\n\n');
      result.push({
        text: batchText,
        startChar: batchStart,
        endChar: batchStart + batchText.length
      });
      batchStart += batchText.length + 2;
      currentParaBatch = [para];
      currentSize = paraSize;
    } else if (paraSize > maxChunkSize) {
      // Single paragraph exceeds maxChunkSize; split by sentences/fixed size
      if (currentParaBatch.length > 0) {
        const batchText = currentParaBatch.join('\n\n');
        result.push({
          text: batchText,
          startChar: batchStart,
          endChar: batchStart + batchText.length
        });
        batchStart += batchText.length + 2;
        currentParaBatch = [];
        currentSize = 0;
      }
      const sentenceChunks = splitFixedSize(para, { maxChunkSize, unit, overlap: 0 });
      for (const sc of sentenceChunks) {
        result.push({
          text: sc.text,
          startChar: batchStart + sc.startChar,
          endChar: batchStart + sc.endChar
        });
      }
      batchStart += para.length + 2;
    } else {
      currentParaBatch.push(para);
      currentSize += paraSize;
    }
  }

  if (currentParaBatch.length > 0) {
    const batchText = currentParaBatch.join('\n\n');
    result.push({
      text: batchText,
      startChar: batchStart,
      endChar: batchStart + batchText.length
    });
  }

  return result;
}

/**
 * ============================================================================
 * Strategy 3: Procedure-Aware Semantic Chunking (Aviation Default)
 *
 * SAFETY INVARIANT: Avoid splitting a numbered procedure or checklist sequence
 * in ways that destroy essential context wherever feasible.
 * ============================================================================
 */
export function splitProcedureAware(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  const maxChunkSize = options.maxChunkSize || DEFAULT_CHUNK_CONFIG.maxChunkSize;
  const minChunkSize = options.minChunkSize || DEFAULT_CHUNK_CONFIG.minChunkSize;
  const unit = options.unit || DEFAULT_CHUNK_CONFIG.unit;
  const includeBreadcrumbs = options.includeHeadingBreadcrumbs !== false;

  // 1. First partition text into semantic blocks: Headings, Procedure Step Groups, Warnings, Prose Blocks, Tables
  const lines = text.split('\n');
  const blocks = [];

  let currentHeadingStack = [];
  let currentBlockType = 'prose';
  let currentBlockLines = [];
  let charTracker = 0;
  let blockStartChar = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check line classification
    const heading = parseHeadingLine(line);
    const isStep = isProceduralStep(trimmed);
    const isWarn = /^(?:WARNING|CAUTION|NOTE|DANGER|MANDATORY)\b/i.test(trimmed);
    const isTbl = isTableLine(trimmed);

    if (heading) {
      // Flush previous block
      if (currentBlockLines.length > 0) {
        blocks.push({
          type: currentBlockType,
          lines: [...currentBlockLines],
          headings: [...currentHeadingStack],
          startChar: blockStartChar,
          endChar: charTracker - 1
        });
        currentBlockLines = [];
      }

      // Update heading stack
      const level = heading.level;
      currentHeadingStack = currentHeadingStack.slice(0, level - 1);
      currentHeadingStack[level - 1] = heading.title;
      currentHeadingStack = currentHeadingStack.filter(Boolean);

      currentBlockType = 'heading';
      blockStartChar = charTracker;
      currentBlockLines.push(line);

      // Flush heading as an anchor block immediately
      blocks.push({
        type: 'heading',
        lines: [line],
        headings: [...currentHeadingStack],
        startChar: blockStartChar,
        endChar: charTracker + line.length
      });
      currentBlockLines = [];
      currentBlockType = 'prose';
    } else if (isStep) {
      if (currentBlockType !== 'procedure' && currentBlockLines.length > 0) {
        blocks.push({
          type: currentBlockType,
          lines: [...currentBlockLines],
          headings: [...currentHeadingStack],
          startChar: blockStartChar,
          endChar: charTracker - 1
        });
        currentBlockLines = [];
        blockStartChar = charTracker;
      }
      currentBlockType = 'procedure';
      currentBlockLines.push(line);
    } else if (isWarn) {
      if (currentBlockType !== 'warning' && currentBlockLines.length > 0) {
        blocks.push({
          type: currentBlockType,
          lines: [...currentBlockLines],
          headings: [...currentHeadingStack],
          startChar: blockStartChar,
          endChar: charTracker - 1
        });
        currentBlockLines = [];
        blockStartChar = charTracker;
      }
      currentBlockType = 'warning';
      currentBlockLines.push(line);
    } else if (isTbl) {
      if (currentBlockType !== 'table' && currentBlockLines.length > 0) {
        blocks.push({
          type: currentBlockType,
          lines: [...currentBlockLines],
          headings: [...currentHeadingStack],
          startChar: blockStartChar,
          endChar: charTracker - 1
        });
        currentBlockLines = [];
        blockStartChar = charTracker;
      }
      currentBlockType = 'table';
      currentBlockLines.push(line);
    } else {
      // Normal prose line
      if ((currentBlockType === 'procedure' || currentBlockType === 'table' || currentBlockType === 'warning') && !trimmed) {
        // Blank line marks boundary for specialized blocks
        blocks.push({
          type: currentBlockType,
          lines: [...currentBlockLines],
          headings: [...currentHeadingStack],
          startChar: blockStartChar,
          endChar: charTracker - 1
        });
        currentBlockLines = [];
        currentBlockType = 'prose';
        blockStartChar = charTracker;
      } else {
        currentBlockLines.push(line);
      }
    }

    charTracker += line.length + 1;
  }

  if (currentBlockLines.length > 0) {
    blocks.push({
      type: currentBlockType,
      lines: [...currentBlockLines],
      headings: [...currentHeadingStack],
      startChar: blockStartChar,
      endChar: charTracker
    });
  }

  // 2. Coalesce blocks into cohesive procedure-governed chunks
  const chunks = [];
  let chunkIndex = 0;

  let currentChunkLines = [];
  let currentHeadings = [];
  let currentStartChar = 0;
  let currentSize = 0;
  let activeWarning = null;

  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const blockText = block.lines.join('\n').trim();
    if (!blockText) continue;

    const blockSize = measureSize(blockText, unit);

    // If this is a warning, hold it so it can be packaged together with the procedure it governs
    if (block.type === 'warning') {
      activeWarning = block;
    }

    // Determine heading breadcrumbs for chunk
    const breadcrumb = (includeBreadcrumbs && block.headings.length > 0)
      ? formatHeadingBreadcrumb(block.headings)
      : '';
    const breadcrumbSize = measureSize(breadcrumb, unit);

    // Case A: The block is a procedure checklist
    if (block.type === 'procedure') {
      // Check if candidate fits with current accumulation
      if (currentSize + blockSize + breadcrumbSize <= maxChunkSize) {
        if (currentChunkLines.length === 0) {
          currentStartChar = activeWarning ? activeWarning.startChar : block.startChar;
          currentHeadings = block.headings;
          if (activeWarning) {
            currentChunkLines.push(...activeWarning.lines);
            activeWarning = null;
          }
        }
        currentChunkLines.push(...block.lines);
        currentSize = measureSize(currentChunkLines.join('\n'), unit);
      } else {
        // Procedure cannot fit with current chunk.
        // Flush existing chunk first.
        if (currentChunkLines.length > 0) {
          const chunkBody = currentChunkLines.join('\n').trim();
          const fullText = (includeBreadcrumbs && currentHeadings.length > 0)
            ? `${formatHeadingBreadcrumb(currentHeadings)}${chunkBody}`
            : chunkBody;

          chunks.push(createChunkRecord({
            text: fullText,
            chunkIndex: chunkIndex++,
            startChar: currentStartChar,
            endChar: currentStartChar + chunkBody.length,
            strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
            headings: currentHeadings
          }));

          currentChunkLines = [];
          currentSize = 0;
        }

        // Now evaluate the procedure block by itself
        if (blockSize + breadcrumbSize <= maxChunkSize) {
          // Procedure fits completely in its own dedicated chunk (Preserving all steps atomically!)
          currentStartChar = activeWarning ? activeWarning.startChar : block.startChar;
          currentHeadings = block.headings;
          if (activeWarning) {
            currentChunkLines.push(...activeWarning.lines);
            activeWarning = null;
          }
          currentChunkLines.push(...block.lines);
          currentSize = measureSize(currentChunkLines.join('\n'), unit);
        } else {
          // Procedure is excessively long and exceeds maxChunkSize.
          // SAFETY INVARIANT: Split ONLY between discrete steps rather than mid-step!
          const stepSlices = splitProcedureStepsCleanly(block.lines, {
            maxChunkSize: maxChunkSize - breadcrumbSize,
            unit
          });

          for (let s = 0; s < stepSlices.length; s++) {
            const sliceLines = stepSlices[s];
            const sliceBody = sliceLines.join('\n').trim();
            const fullText = (includeBreadcrumbs && block.headings.length > 0)
              ? `${formatHeadingBreadcrumb(block.headings)}${sliceBody}`
              : sliceBody;

            chunks.push(createChunkRecord({
              text: fullText,
              chunkIndex: chunkIndex++,
              startChar: block.startChar,
              endChar: block.endChar,
              strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
              headings: block.headings,
              isSplitProcedure: true
            }));
          }
          currentChunkLines = [];
          currentSize = 0;
          activeWarning = null;
        }
      }
      continue;
    }

    // Case B: Non-procedure blocks (prose, table, heading)
    if (currentSize + blockSize + breadcrumbSize <= maxChunkSize) {
      if (currentChunkLines.length === 0) {
        currentStartChar = block.startChar;
        currentHeadings = block.headings;
      }
      currentChunkLines.push(...block.lines);
      currentSize = measureSize(currentChunkLines.join('\n'), unit);
    } else {
      // Flush current chunk
      if (currentChunkLines.length > 0) {
        const chunkBody = currentChunkLines.join('\n').trim();
        const fullText = (includeBreadcrumbs && currentHeadings.length > 0)
          ? `${formatHeadingBreadcrumb(currentHeadings)}${chunkBody}`
          : chunkBody;

        chunks.push(createChunkRecord({
          text: fullText,
          chunkIndex: chunkIndex++,
          startChar: currentStartChar,
          endChar: currentStartChar + chunkBody.length,
          strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
          headings: currentHeadings
        }));

        currentChunkLines = [];
        currentSize = 0;
      }

      // Check if block itself fits or needs sub-splitting
      if (blockSize + breadcrumbSize <= maxChunkSize) {
        currentStartChar = block.startChar;
        currentHeadings = block.headings;
        currentChunkLines.push(...block.lines);
        currentSize = blockSize;
      } else {
        // Large prose or table: split on paragraphs
        const subChunks = subSplitSection(block.lines, {
          maxChunkSize: maxChunkSize - breadcrumbSize,
          unit,
          baseStartChar: block.startChar
        });

        for (const sc of subChunks) {
          const fullText = (includeBreadcrumbs && block.headings.length > 0)
            ? `${formatHeadingBreadcrumb(block.headings)}${sc.text}`
            : sc.text;

          chunks.push(createChunkRecord({
            text: fullText,
            chunkIndex: chunkIndex++,
            startChar: sc.startChar,
            endChar: sc.endChar,
            strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
            headings: block.headings
          }));
        }
      }
    }
  }

  // Flush any remaining accumulated lines
  if (currentChunkLines.length > 0) {
    const chunkBody = currentChunkLines.join('\n').trim();
    const fullText = (includeBreadcrumbs && currentHeadings.length > 0)
      ? `${formatHeadingBreadcrumb(currentHeadings)}${chunkBody}`
      : chunkBody;

    chunks.push(createChunkRecord({
      text: fullText,
      chunkIndex: chunkIndex++,
      startChar: currentStartChar,
      endChar: currentStartChar + chunkBody.length,
      strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
      headings: currentHeadings
    }));
  }

  return chunks;
}

/**
 * Splits a list of procedure step lines strictly between discrete steps.
 */
function splitProcedureStepsCleanly(lines, options) {
  const maxChunkSize = options.maxChunkSize || DEFAULT_CHUNK_CONFIG.maxChunkSize;
  const unit = options.unit || DEFAULT_CHUNK_CONFIG.unit;

  // Group lines into discrete steps (a step line + its continuation lines)
  const steps = [];
  let currentStep = [];

  for (const line of lines) {
    if (isProceduralStep(line.trim()) && currentStep.length > 0) {
      steps.push([...currentStep]);
      currentStep = [line];
    } else {
      currentStep.push(line);
    }
  }
  if (currentStep.length > 0) {
    steps.push(currentStep);
  }

  // Pack steps into slices without splitting across step boundaries
  const slices = [];
  let currentSlice = [];
  let currentSliceSize = 0;

  for (const stepLines of steps) {
    const stepText = stepLines.join('\n');
    const stepSize = measureSize(stepText, unit);

    if (currentSliceSize + stepSize > maxChunkSize && currentSlice.length > 0) {
      slices.push([...currentSlice]);
      currentSlice = [...stepLines];
      currentSliceSize = stepSize;
    } else {
      currentSlice.push(...stepLines);
      currentSliceSize += stepSize;
    }
  }

  if (currentSlice.length > 0) {
    slices.push(currentSlice);
  }

  return slices;
}

/**
 * ============================================================================
 * Primary Public API: chunkText
 * ============================================================================
 * Supports both modern options object and backward-compatible positional args:
 *   chunkText(text, options)
 *   chunkText(text, maxTokens, overlapTokens)
 */
export function chunkText(text, optionsOrMaxTokens = {}, overlapTokens) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return [];
  }

  // Normalize options from positional arguments or object
  let rawOptions = {};
  if (typeof optionsOrMaxTokens === 'number') {
    rawOptions = {
      maxChunkSize: optionsOrMaxTokens,
      overlap: typeof overlapTokens === 'number' ? overlapTokens : DEFAULT_CHUNK_CONFIG.overlap,
      strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE
    };
  } else if (typeof optionsOrMaxTokens === 'object') {
    rawOptions = { ...DEFAULT_CHUNK_CONFIG, ...optionsOrMaxTokens };
  } else {
    rawOptions = { ...DEFAULT_CHUNK_CONFIG };
  }

  const options = normalizeChunkingOptions(rawOptions);

  const strategy = options.strategy || DEFAULT_CHUNK_CONFIG.strategy;
  let chunks;

  switch (strategy) {
    case CHUNK_STRATEGIES.FIXED_SIZE:
      chunks = splitFixedSize(text, options);
      break;
    case CHUNK_STRATEGIES.HEADING_AWARE:
      chunks = splitHeadingAware(text, options);
      break;
    case CHUNK_STRATEGIES.PROCEDURE_AWARE:
    default:
      chunks = splitProcedureAware(text, options);
      break;
  }

  const meta = options.documentMetadata || options.metadata;
  if (meta && typeof meta === 'object') {
    chunks = propagateMetadataToChunks(meta, chunks);
  }

  return chunks;
}

/**
 * ============================================================================
 * Strategy Comparison Engine
 * ============================================================================
 * Evaluates multiple strategies on documents and outputs comparative metrics.
 */
export function compareChunkingStrategies(documents, options = {}) {
  const docs = Array.isArray(documents) ? documents : [documents];
  const strategies = [
    CHUNK_STRATEGIES.FIXED_SIZE,
    CHUNK_STRATEGIES.HEADING_AWARE,
    CHUNK_STRATEGIES.PROCEDURE_AWARE
  ];

  const results = {};

  for (const strat of strategies) {
    const stratConfig = { ...DEFAULT_CHUNK_CONFIG, ...options, strategy: strat };
    let totalChunks = 0;
    let totalTokens = 0;
    let totalChars = 0;
    let totalProceduresSplit = 0;
    let totalWarningsIsolated = 0;
    const chunkSizes = [];

    const docOutputs = [];

    for (const doc of docs) {
      const docText = typeof doc === 'string' ? doc : (doc.text || '');
      const docName = typeof doc === 'object' ? (doc.name || doc.filename || 'Synthetic Document') : 'Synthetic Document';

      const chunks = chunkText(docText, stratConfig);
      totalChunks += chunks.length;

      for (const chunk of chunks) {
        chunkSizes.push(chunk.tokenCount);
        totalTokens += chunk.tokenCount;
        totalChars += chunk.charCount;

        if (chunk.metadata.isSplitProcedure) {
          totalProceduresSplit++;
        }
      }

      docOutputs.push({
        documentName: docName,
        chunkCount: chunks.length,
        chunks: chunks.map(c => ({
          id: c.id,
          tokenCount: c.tokenCount,
          headings: c.metadata.headings,
          containsProcedure: c.metadata.containsProcedure,
          containsWarning: c.metadata.containsWarning,
          preview: c.text.substring(0, 80).replace(/\n/g, ' ')
        }))
      });
    }

    const avgTokens = totalChunks > 0 ? Number((totalTokens / totalChunks).toFixed(1)) : 0;
    const avgChars = totalChunks > 0 ? Number((totalChars / totalChunks).toFixed(1)) : 0;

    // Calculate variance / standard deviation
    let stdDev = 0;
    if (chunkSizes.length > 0) {
      const variance = chunkSizes.reduce((acc, val) => acc + Math.pow(val - avgTokens, 2), 0) / chunkSizes.length;
      stdDev = Number(Math.sqrt(variance).toFixed(1));
    }

    results[strat] = {
      strategy: strat,
      totalChunks,
      averageTokensPerChunk: avgTokens,
      averageCharsPerChunk: avgChars,
      sizeStandardDeviationTokens: stdDev,
      proceduresSplitCount: totalProceduresSplit,
      documentsEvaluated: docOutputs.length,
      documentDetails: docOutputs
    };
  }

  return {
    evaluatedAt: new Date().toISOString(),
    config: {
      maxChunkSize: options.maxChunkSize || DEFAULT_CHUNK_CONFIG.maxChunkSize,
      overlap: options.overlap || DEFAULT_CHUNK_CONFIG.overlap,
      unit: options.unit || DEFAULT_CHUNK_CONFIG.unit
    },
    strategies: results,
    recommendation: {
      defaultStrategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
      rationale: 'Procedure-aware chunking maintains atomic checklist integrity, preserves critical warning-to-step associations, and ensures flight crews receive complete, unbroken operating instructions during RAG retrieval.'
    }
  };
}

/**
 * Configurable DocumentChunker Class
 */
export class DocumentChunker {
  constructor(options = {}) {
    this.options = { ...DEFAULT_CHUNK_CONFIG, ...options };
  }

  chunk(text, docMetadata = {}) {
    const meta = (docMetadata && Object.keys(docMetadata).length > 0)
      ? docMetadata
      : (this.options.documentMetadata || this.options.metadata || null);

    const chunkOptions = meta ? { ...this.options, documentMetadata: meta } : this.options;
    return chunkText(text, chunkOptions);
  }
}
