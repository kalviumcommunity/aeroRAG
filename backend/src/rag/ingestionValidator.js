/**
 * ============================================================================
 * Milestone 3.23 & 3.24: Token-Aware Sizing, Overlap & Corpus Validation
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Implements corpus validation, duplicate detection, partial failure resilience,
 * and comprehensive ingestion reporting for flight operations documentation.
 */

import crypto from 'crypto';
import path from 'path';
import { loadDocument } from './documentLoader.js';
import { cleanText } from './textCleaner.js';
import { chunkText, normalizeChunkingOptions } from './chunker.js';
import {
  validateDocumentMetadata,
  propagateMetadataToChunks
} from './metadataManager.js';

export const INGESTION_STATUS = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  DUPLICATE_SKIPPED: 'DUPLICATE_SKIPPED',
  DUPLICATE_UPDATED: 'DUPLICATE_UPDATED'
});

export const DUPLICATE_STRATEGY = Object.freeze({
  SKIP: 'SKIP',     // Skip duplicate without re-chunking (default for safe idempotent rerun)
  UPDATE: 'UPDATE', // Re-process and overwrite existing document chunks
  ERROR: 'ERROR'    // Treat duplicate as an ingestion validation error
});

export const FAILURE_STAGES = Object.freeze({
  INPUT_VALIDATION: 'INPUT_VALIDATION',
  FILE_LOAD: 'FILE_LOAD',
  TEXT_EXTRACTION: 'TEXT_EXTRACTION',
  TEXT_CLEANING: 'TEXT_CLEANING',
  METADATA_VALIDATION: 'METADATA_VALIDATION',
  CHUNKING: 'CHUNKING'
});

/**
 * Computes a SHA-256 hash for document text content.
 *
 * @param {string} text - Document text.
 * @returns {string} SHA-256 hex digest.
 */
export function computeContentHash(text) {
  if (!text || typeof text !== 'string') return '';
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

/**
 * Counts the number of headings/sections in a document text.
 *
 * @param {string} text - Document text.
 * @returns {number} Count of extracted sections/headings.
 */
export function countExtractedSections(text) {
  if (!text || typeof text !== 'string') return 0;
  const lines = text.split('\n');
  let sectionCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Markdown headings (#, ##, ###)
    if (/^#{1,6}\s+/.test(trimmed)) {
      sectionCount++;
      continue;
    }
    // Uppercase aviation headings (e.g. "EMERGENCY DESCENT CHECKLIST")
    if (
      /^[A-Z0-9\s:.-]{5,}$/.test(trimmed) &&
      trimmed.length < 80 &&
      !trimmed.includes('.') &&
      trimmed.split(/\s+/).length < 10
    ) {
      sectionCount++;
    }
  }

  return sectionCount;
}

/**
 * Core Ingestion Validator and Corpus Intake Engine
 */
export class IngestionValidator {
  /**
   * @param {Object} [options] - Configuration options.
   * @param {string} [options.duplicateStrategy=DUPLICATE_STRATEGY.SKIP] - Action on duplicate input.
   * @param {Object} [options.chunkOptions] - Options passed to chunkText.
   * @param {boolean} [options.strictMetadata=false] - Fail document if critical metadata is missing.
   */
  constructor(options = {}) {
    this.duplicateStrategy = options.duplicateStrategy || DUPLICATE_STRATEGY.SKIP;
    this.chunkOptions = normalizeChunkingOptions(options.chunkOptions || {});
    this.strictMetadata = options.strictMetadata === true;

    // In-memory registry tracking ingested documents (content hashes and IDs)
    this.contentRegistry = new Map(); // contentHash -> Document Record
    this.idRegistry = new Map();      // documentId -> Document Record
    this.processedHistory = [];       // Full historical audit log
  }

  /**
   * Resets the validator registries and audit history.
   */
  reset() {
    this.contentRegistry.clear();
    this.idRegistry.clear();
    this.processedHistory = [];
  }

  /**
   * Ingests and validates a single document input with full failure resilience.
   *
   * @param {string|Object} docInput - File path string or document descriptor object.
   * @param {Object} [options] - Run-specific options.
   * @returns {Promise<Object>} Processed document audit record.
   */
  async processDocument(docInput, options = {}) {
    const runOptions = { ...this.chunkOptions, ...options };
    const startTime = Date.now();

    let documentId = '';
    let filename = '';
    let virtualPath = '';
    let rawText = '';
    let pageCount = 1;
    let initialWarnings = [];

    // Stage 1: Input Normalization & Loading
    try {
      if (!docInput) {
        throw new Error('Document input cannot be null or undefined');
      }

      if (typeof docInput === 'string') {
        // docInput is a file path
        filename = path.basename(docInput);
        virtualPath = `documents/${filename}`;
        documentId = `DOC_${crypto.createHash('md5').update(docInput).digest('hex').substring(0, 8).toUpperCase()}`;

        const loaded = await loadDocument(docInput, runOptions);
        documentId = loaded.id || documentId;
        rawText = loaded.text || '';
        pageCount = loaded.pageCount || 1;
        filename = loaded.filename || filename;
        virtualPath = loaded.metadata?.sanitizedPath || virtualPath;
        if (loaded.warnings) initialWarnings.push(...loaded.warnings);
      } else if (typeof docInput === 'object') {
        // docInput is an object descriptor
        filename = docInput.filename || (docInput.filePath ? path.basename(docInput.filePath) : 'in_memory_doc.txt');
        virtualPath = docInput.virtualPath || `documents/${filename}`;
        documentId = docInput.documentId || docInput.id || '';

        if (docInput.filePath) {
          const loaded = await loadDocument(docInput.filePath, runOptions);
          documentId = documentId || loaded.id;
          rawText = loaded.text || '';
          pageCount = loaded.pageCount || docInput.pageCount || 1;
          if (loaded.warnings) initialWarnings.push(...loaded.warnings);
        } else if (typeof docInput.text === 'string' || typeof docInput.rawText === 'string') {
          rawText = docInput.text || docInput.rawText || '';
          pageCount = docInput.pageCount || 1;
        } else {
          throw new Error(`Document descriptor must provide either 'filePath' or 'text'/'rawText' property`);
        }
      } else {
        throw new Error(`Unsupported document input type: ${typeof docInput}`);
      }
    } catch (err) {
      return {
        documentId: documentId || 'DOC_UNKNOWN',
        filename: filename || 'unknown_document',
        virtualPath: virtualPath || 'documents/unknown',
        status: INGESTION_STATUS.FAILED,
        pageCount: 0,
        sectionCount: 0,
        chunkCount: 0,
        contentHash: '',
        metadata: null,
        chunks: [],
        errors: [err.message],
        warnings: initialWarnings,
        stage: FAILURE_STAGES.FILE_LOAD,
        durationMs: Date.now() - startTime
      };
    }

    // Stage 2: Empty Document Validation
    if (!rawText || rawText.trim().length === 0) {
      return {
        documentId: documentId || 'DOC_EMPTY',
        filename,
        virtualPath,
        status: INGESTION_STATUS.FAILED,
        pageCount,
        sectionCount: 0,
        chunkCount: 0,
        contentHash: '',
        metadata: null,
        chunks: [],
        errors: [`Document "${filename}" contains no extractable text content`],
        warnings: initialWarnings,
        stage: FAILURE_STAGES.TEXT_EXTRACTION,
        durationMs: Date.now() - startTime
      };
    }

    // Stage 3: Text Cleaning Pipeline
    let cleanedText = rawText;
    try {
      const cleanResult = cleanText(rawText);
      cleanedText = cleanResult.cleanedText;
      if (cleanResult.warnings) {
        initialWarnings.push(...cleanResult.warnings.map(w => w.message || String(w)));
      }
    } catch (cleanErr) {
      return {
        documentId,
        filename,
        virtualPath,
        status: INGESTION_STATUS.FAILED,
        pageCount,
        sectionCount: 0,
        chunkCount: 0,
        contentHash: '',
        metadata: null,
        chunks: [],
        errors: [`Text cleaning failed: ${cleanErr.message}`],
        warnings: initialWarnings,
        stage: FAILURE_STAGES.TEXT_CLEANING,
        durationMs: Date.now() - startTime
      };
    }

    // Stage 4: Duplicate Detection (SHA-256 Content Hash & Document ID)
    const contentHash = computeContentHash(cleanedText);
    const existingByHash = this.contentRegistry.get(contentHash);
    const existingById = documentId ? this.idRegistry.get(documentId) : null;
    const isDuplicate = Boolean(existingByHash || existingById);

    if (isDuplicate) {
      const duplicateOf = existingByHash ? existingByHash.documentId : existingById.documentId;
      const matchedBy = existingByHash ? 'CONTENT_HASH' : 'DOCUMENT_ID';

      if (this.duplicateStrategy === DUPLICATE_STRATEGY.ERROR) {
        return {
          documentId,
          filename,
          virtualPath,
          status: INGESTION_STATUS.FAILED,
          pageCount,
          sectionCount: countExtractedSections(cleanedText),
          chunkCount: 0,
          contentHash,
          metadata: null,
          chunks: [],
          errors: [`Duplicate document detected (matches ${duplicateOf} by ${matchedBy})`],
          warnings: initialWarnings,
          stage: FAILURE_STAGES.INPUT_VALIDATION,
          duplicateInfo: { duplicateOf, matchedBy, actionTaken: 'ERROR' },
          durationMs: Date.now() - startTime
        };
      } else if (this.duplicateStrategy === DUPLICATE_STRATEGY.SKIP) {
        return {
          documentId: documentId || duplicateOf,
          filename,
          virtualPath,
          status: INGESTION_STATUS.DUPLICATE_SKIPPED,
          pageCount,
          sectionCount: countExtractedSections(cleanedText),
          chunkCount: existingByHash?.chunkCount || existingById?.chunkCount || 0,
          contentHash,
          metadata: existingByHash?.metadata || existingById?.metadata || null,
          chunks: [],
          errors: [],
          warnings: [...initialWarnings, `Duplicate input skipped: identical to already ingested document ${duplicateOf}`],
          duplicateInfo: { duplicateOf, matchedBy, actionTaken: 'SKIPPED' },
          durationMs: Date.now() - startTime
        };
      }
      // If DUPLICATE_STRATEGY.UPDATE: continue and overwrite registry below
    }

    // Stage 5: Metadata Validation & Normalization
    let validatedMetadata = null;
    try {
      const rawMeta = typeof docInput === 'object' && docInput.metadata ? docInput.metadata : {};
      const metadataPayload = {
        ...rawMeta,
        documentId: documentId || rawMeta.documentId,
        title: rawMeta.title || filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
      };

      validatedMetadata = validateDocumentMetadata(metadataPayload, runOptions);
      documentId = validatedMetadata.documentId;

      if (this.strictMetadata && validatedMetadata.uncertainties.length > 0) {
        throw new Error(`Strict metadata validation failed: ${validatedMetadata.uncertainties.join(', ')}`);
      }
    } catch (metaErr) {
      return {
        documentId: documentId || 'DOC_METADATA_FAIL',
        filename,
        virtualPath,
        status: INGESTION_STATUS.FAILED,
        pageCount,
        sectionCount: countExtractedSections(cleanedText),
        chunkCount: 0,
        contentHash,
        metadata: null,
        chunks: [],
        errors: [`Metadata validation failed: ${metaErr.message}`],
        warnings: initialWarnings,
        stage: FAILURE_STAGES.METADATA_VALIDATION,
        durationMs: Date.now() - startTime
      };
    }

    // Stage 6: Token-Aware Chunking & Overlap
    let chunks = [];
    try {
      chunks = chunkText(cleanedText, {
        ...runOptions,
        documentMetadata: validatedMetadata
      });
    } catch (chunkErr) {
      return {
        documentId,
        filename,
        virtualPath,
        status: INGESTION_STATUS.FAILED,
        pageCount,
        sectionCount: countExtractedSections(cleanedText),
        chunkCount: 0,
        contentHash,
        metadata: validatedMetadata,
        chunks: [],
        errors: [`Chunking failed: ${chunkErr.message}`],
        warnings: initialWarnings,
        stage: FAILURE_STAGES.CHUNKING,
        durationMs: Date.now() - startTime
      };
    }

    const sectionCount = countExtractedSections(cleanedText);
    const finalStatus = isDuplicate && this.duplicateStrategy === DUPLICATE_STRATEGY.UPDATE
      ? INGESTION_STATUS.DUPLICATE_UPDATED
      : INGESTION_STATUS.SUCCESS;

    const record = {
      documentId,
      filename,
      virtualPath,
      status: finalStatus,
      pageCount,
      sectionCount,
      chunkCount: chunks.length,
      contentHash,
      metadata: validatedMetadata,
      chunks,
      errors: [],
      warnings: initialWarnings,
      duplicateInfo: isDuplicate ? { duplicateOf: documentId, matchedBy: 'CONTENT_HASH', actionTaken: 'UPDATED' } : null,
      durationMs: Date.now() - startTime
    };

    // Register document in registries for future duplicate checks & idempotent reruns
    this.contentRegistry.set(contentHash, record);
    this.idRegistry.set(documentId, record);
    this.processedHistory.push(record);

    return record;
  }

  /**
   * Ingests and validates an entire corpus of documents.
   *
   * Partial failures are reported honestly and never halt processing.
   *
   * @param {Array<string|Object>} corpus - Array of file paths or document objects.
   * @param {Object} [options] - Ingestion configuration options.
   * @returns {Promise<Object>} Comprehensive Ingestion Validation Report.
   */
  async processCorpus(corpus = [], options = {}) {
    const startTime = Date.now();
    const docList = Array.isArray(corpus) ? corpus : [corpus];

    const documents = [];
    const failures = [];
    const duplicates = [];

    let totalExtractedPages = 0;
    let totalExtractedSections = 0;
    let totalChunksCreated = 0;
    let totalMetadataErrors = 0;
    const uncertaintyBreakdown = {};

    for (const docInput of docList) {
      const result = await this.processDocument(docInput, options);
      documents.push(result);

      if (result.status === INGESTION_STATUS.FAILED) {
        failures.push({
          documentId: result.documentId,
          filename: result.filename,
          stage: result.stage,
          error: result.errors.join('; '),
          fatal: true
        });
      } else {
        totalExtractedPages += result.pageCount;
        totalExtractedSections += result.sectionCount;

        if (result.status !== INGESTION_STATUS.DUPLICATE_SKIPPED) {
          totalChunksCreated += result.chunkCount;
        }

        if (result.metadata && result.metadata.uncertainties) {
          totalMetadataErrors += result.metadata.uncertainties.length;
          for (const u of result.metadata.uncertainties) {
            uncertaintyBreakdown[u] = (uncertaintyBreakdown[u] || 0) + 1;
          }
        }
      }

      if (result.duplicateInfo) {
        duplicates.push({
          documentId: result.documentId,
          filename: result.filename,
          ...result.duplicateInfo
        });
      }
    }

    const processedDocuments = documents.filter(d =>
      d.status === INGESTION_STATUS.SUCCESS || d.status === INGESTION_STATUS.DUPLICATE_UPDATED
    ).length;

    const duplicateInputs = duplicates.length;
    const failedDocuments = failures.length;
    const totalDocuments = docList.length;
    const successRate = totalDocuments > 0
      ? Number(((processedDocuments / totalDocuments) * 100).toFixed(1))
      : 100.0;

    const report = {
      runId: `INGEST_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      summary: {
        totalDocuments,
        processedDocuments,
        failedDocuments,
        duplicateInputs,
        chunksCreated: totalChunksCreated,
        extractedPages: totalExtractedPages,
        extractedSections: totalExtractedSections,
        metadataErrors: totalMetadataErrors,
        successRate
      },
      documents: documents.map(d => ({
        documentId: d.documentId,
        filename: d.filename,
        virtualPath: d.virtualPath,
        status: d.status,
        pageCount: d.pageCount,
        sectionCount: d.sectionCount,
        chunkCount: d.chunkCount,
        contentHash: d.contentHash,
        metadata: d.metadata,
        errors: d.errors,
        warnings: d.warnings
      })),
      failures,
      duplicates,
      metadataValidationSummary: {
        totalUncertainties: totalMetadataErrors,
        uncertaintyBreakdown
      }
    };

    return report;
  }

  /**
   * Formats the ingestion validation report as human-readable Markdown.
   *
   * @param {Object} report - Ingestion validation report.
   * @returns {string} Formatted Markdown text.
   */
  formatMarkdownReport(report) {
    const s = report.summary;
    let md = `# AeroRAG Ingestion Validation Report\n\n`;
    md += `- **Run ID:** \`${report.runId}\`\n`;
    md += `- **Timestamp:** ${report.timestamp}\n`;
    md += `- **Duration:** ${report.durationMs} ms\n`;
    md += `- **Success Rate:** **${s.successRate}%**\n\n`;

    md += `## 1. Corpus Summary\n\n`;
    md += `| Metric | Count |\n`;
    md += `| :--- | :--- |\n`;
    md += `| Total Documents Submitted | ${s.totalDocuments} |\n`;
    md += `| Processed Successfully | ${s.processedDocuments} |\n`;
    md += `| Failed Documents | ${s.failedDocuments} |\n`;
    md += `| Duplicate Inputs Detected | ${s.duplicateInputs} |\n`;
    md += `| Total Chunks Created | ${s.chunksCreated} |\n`;
    md += `| Total Extracted Pages | ${s.extractedPages} |\n`;
    md += `| Total Extracted Sections | ${s.extractedSections} |\n`;
    md += `| Metadata Validation Errors | ${s.metadataErrors} |\n\n`;

    if (report.failures.length > 0) {
      md += `## 2. Ingestion Failures (${report.failures.length})\n\n`;
      md += `| Document ID | Filename | Failure Stage | Error Diagnostics |\n`;
      md += `| :--- | :--- | :--- | :--- |\n`;
      for (const f of report.failures) {
        md += `| \`${f.documentId}\` | \`${f.filename}\` | \`${f.stage}\` | ${f.error} |\n`;
      }
      md += `\n`;
    }

    if (report.duplicates.length > 0) {
      md += `## 3. Duplicate Inputs (${report.duplicates.length})\n\n`;
      md += `| Document ID | Filename | Matched By | Duplicate Of | Action Taken |\n`;
      md += `| :--- | :--- | :--- | :--- | :--- |\n`;
      for (const d of report.duplicates) {
        md += `| \`${d.documentId}\` | \`${d.filename}\` | \`${d.matchedBy}\` | \`${d.duplicateOf}\` | **${d.actionTaken}** |\n`;
      }
      md += `\n`;
    }

    md += `## 4. Document Ingestion Details\n\n`;
    md += `| Document ID | Status | Pages | Sections | Chunks | Warnings |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    for (const d of report.documents) {
      const warnCount = d.warnings.length;
      md += `| \`${d.documentId}\` | \`${d.status}\` | ${d.pageCount} | ${d.sectionCount} | ${d.chunkCount} | ${warnCount} |\n`;
    }

    return md;
  }
}

/**
 * Functional convenience wrapper for single-call corpus validation.
 *
 * @param {Array<string|Object>} corpus - Array of documents to ingest.
 * @param {Object} [options] - Options passed to IngestionValidator.
 * @returns {Promise<Object>} Ingestion validation report.
 */
export async function validateCorpusIngestion(corpus, options = {}) {
  const validator = new IngestionValidator(options);
  return await validator.processCorpus(corpus, options);
}
