import { loadDocument } from '../rag/documentLoader.js';

/**
 * Extracts plain text from multiple document formats:
 * - PDF (.pdf)
 * - Microsoft Word (.docx)
 * - Plain Text (.txt)
 * - Markdown (.md, .markdown)
 * - HTML (.html, .htm)
 *
 * Integrates with Milestone 3.19 modular document loaders, security sanitization,
 * and scanned PDF detection.
 */
export const extractText = async (filePath, explicitFileType = null) => {
  const doc = await loadDocument(filePath, {
    fileType: explicitFileType,
    throwOnError: true
  });

  return {
    text: doc.text,
    pageCount: doc.pageCount,
    format: doc.format,
    isScanned: doc.isScanned,
    requiresOcr: doc.requiresOcr,
    status: doc.status,
    charCount: doc.charCount,
    wordCount: doc.wordCount,
    metadata: doc.metadata
  };
};
