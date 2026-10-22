import fs from 'fs';
import path from 'path';
import { extractText } from '../utils/textExtractor.js';
import logger from '../utils/logger.js';

/**
 * Loads a single document from disk into a clean plain text representation.
 * Preserves source identity, format, character length, and sample.
 * Handles missing, corrupt, or unsupported files gracefully.
 */
export async function loadDocument(filePath) {
  const filename = path.basename(filePath);

  // Check file existence
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      source: filename,
      path: filePath,
      error: `File does not exist: ${filePath}`
    };
  }

  // Check if directory
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return {
      success: false,
      source: filename,
      path: filePath,
      error: `Path is a directory, not a file`
    };
  }

  try {
    const { text, pageCount, format } = await extractText(filePath);

    if (!text || text.trim().length === 0) {
      return {
        success: false,
        source: filename,
        path: filePath,
        format,
        error: `Extracted text is empty`
      };
    }

    return {
      success: true,
      source: filename,
      path: filePath,
      format,
      charCount: text.length,
      pageCount: pageCount || 1,
      text,
      sample: text.substring(0, 80).replace(/\r?\n|\r/g, ' ')
    };
  } catch (err) {
    return {
      success: false,
      source: filename,
      path: filePath,
      error: err.message
    };
  }
}

/**
 * Scans a directory of mixed document formats (PDF, HTML, MD, TXT).
 * Survives missing, corrupt, or unsupported files without crashing.
 * Confirms intake by logging character count and sample preview.
 */
export async function loadCorpus(dirPath) {
  if (!fs.existsSync(dirPath)) {
    throw new Error(`Corpus directory does not exist: ${dirPath}`);
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const loadedDocs = [];
  const skippedDocs = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories if needed
      const subResults = await loadCorpus(fullPath);
      loadedDocs.push(...subResults.loadedDocs);
      skippedDocs.push(...subResults.skippedDocs);
      continue;
    }

    const result = await loadDocument(fullPath);

    if (result.success) {
      loadedDocs.push({
        source: result.source,
        path: result.path,
        format: result.format,
        charCount: result.charCount,
        sample: result.sample,
        text: result.text
      });
      console.log(`OK ${result.source}: ${result.charCount} chars | '${result.sample}'`);
    } else {
      skippedDocs.push({
        source: result.source,
        path: result.path,
        reason: result.error
      });
      console.log(`SKIP ${result.source}: ${result.error}`);
    }
  }

  return {
    loadedDocs,
    skippedDocs,
    stats: {
      totalFiles: entries.filter(e => !e.isDirectory()).length,
      loadedCount: loadedDocs.length,
      skippedCount: skippedDocs.length,
      supportedFormats: [...new Set(loadedDocs.map(d => d.format))]
    }
  };
}
