import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mammoth from 'mammoth';
import { createRequire } from 'module';
import { cleanText } from './textCleaner.js';

export {
  cleanText,
  normalizeEncoding,
  normalizeWhitespace,
  removeBoilerplate,
  extractQualityMetrics,
  detectStructure,
  isSafetyCritical,
  isProceduralStep,
  TextCleaningPipeline
} from './textCleaner.js';

const require = createRequire(import.meta.url);
const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

/**
 * ============================================================================
 * Milestone 3.19: Document Loading & Multi-Format Intake
 * Airline Procedure Intelligence System
 * ============================================================================
 */

// Default configuration constants
export const DEFAULT_MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const DEFAULT_OCR_CHAR_THRESHOLD = 35; // Fewer characters on page indicates scanned image

export const MIME_TYPE_MAP = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  html: 'text/html',
  htm: 'text/html'
});

export const SUPPORTED_FORMATS = Object.freeze(['pdf', 'docx', 'txt', 'md', 'markdown', 'html', 'htm']);

/**
 * Custom Error Hierarchy for Document Loaders
 */
export class DocumentLoaderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentLoaderError';
  }
}

export class DocumentNotFoundError extends DocumentLoaderError {
  constructor(filename) {
    super(`Document not found: "${filename}"`);
    this.name = 'DocumentNotFoundError';
    this.filename = filename;
  }
}

export class UnsupportedFormatError extends DocumentLoaderError {
  constructor(attemptedFormat, supportedFormats, filename) {
    const cleanExt = (attemptedFormat || '').replace(/^\./, '').toLowerCase();
    super(
      `Unsupported file format "${cleanExt}" for document "${filename}". Supported formats: ${supportedFormats.join(', ')}`
    );
    this.name = 'UnsupportedFormatError';
    this.attemptedFormat = cleanExt;
    this.supportedFormats = supportedFormats;
    this.filename = filename;
  }
}

export class EmptyDocumentError extends DocumentLoaderError {
  constructor(filename, reason = 'Document contains no extractable content or is 0 bytes') {
    super(`Empty document detected: "${filename}". ${reason}`);
    this.name = 'EmptyDocumentError';
    this.filename = filename;
  }
}

export class DocumentSizeExceededError extends DocumentLoaderError {
  constructor(filename, actualSizeBytes, maxSizeBytes) {
    const actualKB = (actualSizeBytes / 1024).toFixed(1);
    const maxKB = (maxSizeBytes / 1024).toFixed(1);
    super(
      `Document "${filename}" size (${actualKB} KB) exceeds maximum limit (${maxKB} KB)`
    );
    this.name = 'DocumentSizeExceededError';
    this.filename = filename;
    this.actualSizeBytes = actualSizeBytes;
    this.maxSizeBytes = maxSizeBytes;
  }
}

export class CorruptedDocumentError extends DocumentLoaderError {
  constructor(filename, underlyingError) {
    super(`Corrupted or unreadable document "${filename}": ${underlyingError}`);
    this.name = 'CorruptedDocumentError';
    this.filename = filename;
    this.underlyingError = underlyingError;
  }
}

export class SecurityViolationError extends DocumentLoaderError {
  constructor(filename, reason) {
    super(`Security policy violation in document "${filename}": ${reason}`);
    this.name = 'SecurityViolationError';
    this.filename = filename;
  }
}

/**
 * Sanitization & Security Utilities (Untrusted Input Protection)
 */

/**
 * Sanitizes input filename to prevent directory traversal and special control characters.
 */
export function sanitizeFilename(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return 'document';
  const base = path.basename(rawPath).replace(/[\/\\]/g, '');
  // Remove control characters (0x00-0x1F, 0x7F) and null bytes
  return base.replace(/[\x00-\x1f\x7f]/g, '').trim() || 'document';
}

/**
 * Produces a virtual sanitized relative path (e.g. documents/filename.pdf)
 * Never exposes local or server host absolute paths (C:\Users\... or /home/...)
 */
export function sanitizeFilePath(rawPath) {
  const filename = sanitizeFilename(rawPath);
  return `documents/${filename}`;
}

/**
 * Cleans extracted text to neutralize embedded executable payloads, scripts,
 * iframes, and javascript: pseudo-protocols from untrusted uploads.
 */
export function sanitizeExtractedText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let sanitized = rawText;

  // Strip null bytes
  sanitized = sanitized.replace(/\x00/g, '');

  // Strip executable HTML/XML script and style blocks
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Strip iframe, object, embed, and applet blocks
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
  sanitized = sanitized.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
  sanitized = sanitized.replace(/<embed\b[^>]*>/gi, '');

  // Neutralize inline javascript: URIs
  sanitized = sanitized.replace(/javascript:[^\s"'>]+/gi, '[REDACTED_JS]');

  // Strip dangerous inline event handlers like onload=, onerror=, onclick=
  sanitized = sanitized.replace(/\son\w+\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '');

  return sanitized;
}

/**
 * Generates a deterministic document ID from content and filename.
 */
export function generateDocumentId(content, filename) {
  const hash = crypto.createHash('sha256')
    .update(filename || '')
    .update(content || '')
    .digest('hex')
    .substring(0, 16);
  return `doc_${hash}`;
}

/**
 * ============================================================================
 * Modular Loader Implementations
 * ============================================================================
 */

export class BaseLoader {
  constructor(format, mimeType) {
    this.format = format;
    this.mimeType = mimeType;
  }

  async load(filePath, options = {}) {
    throw new Error('BaseLoader.load() must be overridden by concrete loader');
  }
}

/**
 * PDF Loader: Extracts plain text and page metadata using PDFJS.
 * Identifies scanned or image-only PDFs that require OCR rather than silently treating as complete.
 */
export class PdfLoader extends BaseLoader {
  constructor() {
    super('pdf', MIME_TYPE_MAP.pdf);
  }

  async load(filePath, options = {}) {
    const filename = sanitizeFilename(filePath);
    let dataBuffer;
    try {
      dataBuffer = await fs.promises.readFile(filePath);
    } catch (err) {
      throw new DocumentNotFoundError(filename);
    }

    let doc;
    try {
      const uint8 = new Uint8Array(dataBuffer);
      doc = await PDFJS.getDocument({ data: uint8 });
    } catch (err) {
      throw new CorruptedDocumentError(filename, err.message || 'Invalid or unreadable PDF structure');
    }

    const numPages = doc.numPages || 1;
    let fullText = '';

    try {
      for (let i = 1; i <= numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += (i > 1 ? '\n\n' : '') + pageText;
      }
    } catch (err) {
      throw new CorruptedDocumentError(filename, `Error parsing PDF page streams: ${err.message}`);
    }

    const cleanText = fullText.trim();
    const ocrThreshold = options.ocrCharThreshold || DEFAULT_OCR_CHAR_THRESHOLD;
    
    // Scanned PDF detection: valid pages present, but extractable text is absent or minimal
    const isScanned = cleanText.length < ocrThreshold;

    const words = cleanText ? cleanText.split(/\s+/).filter(Boolean) : [];

    return {
      format: 'pdf',
      mimeType: this.mimeType,
      text: isScanned ? '' : cleanText,
      pageCount: numPages,
      charCount: isScanned ? 0 : cleanText.length,
      wordCount: isScanned ? 0 : words.length,
      isScanned,
      requiresOcr: isScanned,
      status: isScanned ? 'REQUIRES_OCR' : 'SUCCESS',
      ocrReason: isScanned
        ? `Document has ${numPages} page(s) with only ${cleanText.length} extractable character(s); scanned image or non-text PDF detected`
        : null
    };
  }
}

/**
 * DOCX Loader: Extracts structured text from OpenXML DOCX files using mammoth.
 * Runs in safe isolated mode without macro execution or external entity resolution.
 */
export class DocxLoader extends BaseLoader {
  constructor() {
    super('docx', MIME_TYPE_MAP.docx);
  }

  async load(filePath, options = {}) {
    const filename = sanitizeFilename(filePath);
    let buffer;
    try {
      buffer = await fs.promises.readFile(filePath);
    } catch (err) {
      throw new DocumentNotFoundError(filename);
    }

    let result;
    try {
      result = await mammoth.extractRawText({ buffer });
    } catch (err) {
      throw new CorruptedDocumentError(filename, err.message || 'Invalid or damaged DOCX package');
    }

    const rawText = (result.value || '').trim();
    if (!rawText) {
      throw new EmptyDocumentError(filename, 'DOCX file contains no extractable text paragraphs');
    }

    const words = rawText.split(/\s+/).filter(Boolean);
    const estimatedPages = Math.max(1, Math.ceil(words.length / 400));

    return {
      format: 'docx',
      mimeType: this.mimeType,
      text: rawText,
      pageCount: estimatedPages,
      charCount: rawText.length,
      wordCount: words.length,
      isScanned: false,
      requiresOcr: false,
      status: 'SUCCESS',
      warnings: (result.messages || []).map(m => m.message)
    };
  }
}

/**
 * Text Loader: Reads plain text documents (.txt) with BOM handling.
 */
export class TextLoader extends BaseLoader {
  constructor() {
    super('txt', MIME_TYPE_MAP.txt);
  }

  async load(filePath, options = {}) {
    const filename = sanitizeFilename(filePath);
    let rawText;
    try {
      rawText = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new DocumentNotFoundError(filename);
    }

    // Strip UTF-8 Byte Order Mark (BOM) if present
    if (rawText.charCodeAt(0) === 0xFEFF) {
      rawText = rawText.slice(1);
    }

    const cleanText = rawText.trim();
    if (!cleanText) {
      throw new EmptyDocumentError(filename, 'Plain text document is empty (0 bytes or whitespace only)');
    }

    const words = cleanText.split(/\s+/).filter(Boolean);
    const estimatedPages = Math.max(1, Math.ceil(words.length / 400));

    return {
      format: 'txt',
      mimeType: this.mimeType,
      text: cleanText,
      pageCount: estimatedPages,
      charCount: cleanText.length,
      wordCount: words.length,
      isScanned: false,
      requiresOcr: false,
      status: 'SUCCESS'
    };
  }
}

/**
 * Markdown Loader: Reads Markdown documents (.md, .markdown) and extracts section headings.
 */
export class MarkdownLoader extends BaseLoader {
  constructor() {
    super('md', MIME_TYPE_MAP.md);
  }

  async load(filePath, options = {}) {
    const filename = sanitizeFilename(filePath);
    let rawText;
    try {
      rawText = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new DocumentNotFoundError(filename);
    }

    // Strip UTF-8 BOM
    if (rawText.charCodeAt(0) === 0xFEFF) {
      rawText = rawText.slice(1);
    }

    const cleanText = rawText.trim();
    if (!cleanText) {
      throw new EmptyDocumentError(filename, 'Markdown document contains no text content');
    }

    // Extract markdown headings for structural metadata
    const headingRegex = /^(#{1,6})\s+(.+)$/gm;
    const headings = [];
    let match;
    while ((match = headingRegex.exec(cleanText)) !== null) {
      headings.push({ level: match[1].length, title: match[2].trim() });
    }

    const words = cleanText.split(/\s+/).filter(Boolean);
    const estimatedPages = Math.max(1, Math.ceil(words.length / 400));

    return {
      format: 'md',
      mimeType: this.mimeType,
      text: cleanText,
      pageCount: estimatedPages,
      charCount: cleanText.length,
      wordCount: words.length,
      isScanned: false,
      requiresOcr: false,
      status: 'SUCCESS',
      headings
    };
  }
}

/**
 * HTML Loader: Extracts plain text from HTML documents, safely stripping script and style blocks.
 */
export class HtmlLoader extends BaseLoader {
  constructor() {
    super('html', MIME_TYPE_MAP.html);
  }

  async load(filePath, options = {}) {
    const filename = sanitizeFilename(filePath);
    let rawHtml;
    try {
      rawHtml = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new DocumentNotFoundError(filename);
    }

    // Strip script, style, and noscript blocks
    let clean = rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    clean = clean.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
    // Strip HTML tags
    clean = clean.replace(/<[^>]+>/g, ' ');
    // Normalize whitespace
    clean = clean.replace(/\s+/g, ' ').trim();

    if (!clean) {
      throw new EmptyDocumentError(filename, 'HTML contains no readable body text');
    }

    const words = clean.split(/\s+/).filter(Boolean);
    const estimatedPages = Math.max(1, Math.ceil(words.length / 400));

    return {
      format: 'html',
      mimeType: this.mimeType,
      text: clean,
      pageCount: estimatedPages,
      charCount: clean.length,
      wordCount: words.length,
      isScanned: false,
      requiresOcr: false,
      status: 'SUCCESS'
    };
  }
}

/**
 * ============================================================================
 * Loader Registry
 * ============================================================================
 */

const loaderRegistry = new Map();

// Register default loaders
loaderRegistry.set('pdf', new PdfLoader());
loaderRegistry.set('docx', new DocxLoader());
loaderRegistry.set('txt', new TextLoader());
loaderRegistry.set('md', new MarkdownLoader());
loaderRegistry.set('markdown', new MarkdownLoader());
loaderRegistry.set('html', new HtmlLoader());
loaderRegistry.set('htm', new HtmlLoader());

export function registerLoader(format, loaderInstance) {
  const normFormat = (format || '').toLowerCase().replace(/^\./, '');
  loaderRegistry.set(normFormat, loaderInstance);
}

export function getLoader(format) {
  const normFormat = (format || '').toLowerCase().replace(/^\./, '');
  return loaderRegistry.get(normFormat) || null;
}

export function getSupportedFormats() {
  return Array.from(new Set(loaderRegistry.keys()));
}

/**
 * ============================================================================
 * Primary Public API: loadDocument & loadCorpus
 * ============================================================================
 */

/**
 * Loads and validates a single document with untrusted input protections.
 *
 * @param {string} filePath - Absolute or relative path to the document.
 * @param {Object} options - Ingestion configuration options.
 * @param {boolean} [options.throwOnError=true] - Whether to throw typed errors or return error results.
 * @param {string} [options.format] - Explicit format override ('pdf', 'docx', 'txt', 'md').
 * @param {string} [options.fileType] - Alias for options.format.
 * @param {number} [options.maxSizeBytes=DEFAULT_MAX_DOCUMENT_SIZE_BYTES] - Maximum allowed file size.
 * @param {number} [options.ocrCharThreshold=DEFAULT_OCR_CHAR_THRESHOLD] - Threshold below which PDF is flagged scanned.
 * @param {string} [options.documentId] - Optional explicit document identifier.
 * @returns {Promise<Object>} Normalized document record.
 */
export async function loadDocument(filePath, options = {}) {
  const throwOnError = options.throwOnError !== false;
  const filename = sanitizeFilename(filePath);
  const virtualPath = sanitizeFilePath(filePath);
  const maxSizeBytes = options.maxSizeBytes || DEFAULT_MAX_DOCUMENT_SIZE_BYTES;

  try {
    // 1. Validation: file existence
    if (!fs.existsSync(filePath)) {
      throw new DocumentNotFoundError(filename);
    }

    // 2. Validation: not a directory
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      throw new DocumentLoaderError(`Path is a directory, not a document: "${filename}"`);
    }

    // 3. Validation: size limit
    if (stat.size > maxSizeBytes) {
      throw new DocumentSizeExceededError(filename, stat.size, maxSizeBytes);
    }

    // 4. Validation: non-empty file (0 bytes)
    if (stat.size === 0) {
      throw new EmptyDocumentError(filename, 'File size is 0 bytes');
    }

    // 5. Determine format
    const explicitFormat = (options.format || options.fileType || '').toLowerCase().replace(/^\./, '');
    const extFormat = path.extname(filePath).toLowerCase().replace(/^\./, '');
    let format = explicitFormat || extFormat;
    if (format === 'markdown') format = 'md';
    if (format === 'htm') format = 'html';

    // 6. Validate format support
    const loader = getLoader(format);
    if (!loader) {
      throw new UnsupportedFormatError(format, getSupportedFormats(), filename);
    }

    // 7. Load via modular loader
    const extraction = await loader.load(filePath, options);

    // 8. Sanitize extracted text (prevent script execution from document payloads)
    const sanitizedText = sanitizeExtractedText(extraction.text);

    // 9. Clean text via deterministic cleaning pipeline (Milestone 3.20)
    let cleanedText = sanitizedText;
    let cleaningResult = null;
    if (!extraction.isScanned && sanitizedText) {
      cleaningResult = cleanText(sanitizedText, options);
      cleanedText = cleaningResult.cleanedText;
    }

    // 10. Generate deterministic ID
    const docId = options.documentId || generateDocumentId(cleanedText || filename, filename);

    const warnings = [...(extraction.warnings || [])];
    if (cleaningResult && cleaningResult.warnings && cleaningResult.warnings.length > 0) {
      warnings.push(...cleaningResult.warnings.map(w => w.message));
    }

    return {
      id: docId,
      filename,
      contentType: extraction.mimeType,
      format: extraction.format,
      text: cleanedText,
      charCount: extraction.isScanned ? 0 : cleanedText.length,
      wordCount: extraction.isScanned ? 0 : (cleanedText ? cleanedText.split(/\s+/).filter(Boolean).length : 0),
      pageCount: extraction.pageCount || 1,
      isScanned: extraction.isScanned || false,
      requiresOcr: extraction.requiresOcr || false,
      status: extraction.status || 'SUCCESS',
      metadata: {
        sanitizedPath: virtualPath,
        fileSizeBytes: stat.size,
        extractionTimestamp: new Date().toISOString(),
        extractedWith: loader.constructor.name,
        ocrReason: extraction.ocrReason || null,
        headings: (cleaningResult && cleaningResult.structure.headings.length > 0)
          ? cleaningResult.structure.headings
          : (extraction.headings || undefined),
        warnings: warnings.length > 0 ? warnings : undefined,
        qualityMetrics: cleaningResult ? cleaningResult.qualityMetrics : undefined
      }
    };
  } catch (err) {
    if (throwOnError) {
      throw err;
    }
    return {
      success: false,
      filename,
      status: 'FAILED',
      error: err.message,
      errorCode: err.name || 'DOCUMENT_LOADER_ERROR'
    };
  }
}

/**
 * Loads an entire directory of mixed-format documents.
 * Survives missing, corrupted, or unsupported documents without halting batch execution.
 *
 * @param {string} dirPath - Directory containing documents.
 * @param {Object} options - Loading options.
 * @returns {Promise<Object>} Ingestion summary with loaded, ocrRequired, and skipped documents.
 */
export async function loadCorpus(dirPath, options = {}) {
  const sanitizedDir = sanitizeFilename(dirPath);
  if (!fs.existsSync(dirPath)) {
    throw new DocumentNotFoundError(sanitizedDir);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const loadedDocs = [];
  const skippedDocs = [];
  const ocrRequiredDocs = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (options.recursive !== false) {
        const subResults = await loadCorpus(fullPath, options);
        loadedDocs.push(...subResults.loadedDocs);
        skippedDocs.push(...subResults.skippedDocs);
        ocrRequiredDocs.push(...subResults.ocrRequiredDocs);
      }
      continue;
    }

    const result = await loadDocument(fullPath, { ...options, throwOnError: false });

    if (result.status === 'SUCCESS') {
      loadedDocs.push(result);
    } else if (result.status === 'REQUIRES_OCR') {
      ocrRequiredDocs.push(result);
      if (options.includeOcrInLoaded) {
        loadedDocs.push(result);
      }
    } else {
      skippedDocs.push({
        filename: result.filename,
        reason: result.error,
        errorCode: result.errorCode
      });
    }
  }

  return {
    loadedDocs,
    ocrRequiredDocs,
    skippedDocs,
    stats: {
      totalFiles: entries.filter(e => !e.isDirectory()).length,
      loadedCount: loadedDocs.length,
      ocrRequiredCount: ocrRequiredDocs.length,
      skippedCount: skippedDocs.length,
      supportedFormats: [...new Set(loadedDocs.map(d => d.format))]
    }
  };
}
