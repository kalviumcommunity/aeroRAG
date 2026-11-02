import fs from 'fs/promises';
import path from 'path';

/**
 * Normalizes HTML content into clean plain text
 */
function cleanHtml(rawHtml) {
  let clean = rawHtml;
  // Remove script, style, head, svg, and comment blocks
  clean = clean.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ');
  clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ');
  clean = clean.replace(/<head\b[^<]*(?:(?!<\/head>)<[^<]*)*<\/head>/gi, ' ');
  clean = clean.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ');
  clean = clean.replace(/<!--[\s\S]*?-->/g, ' ');

  // Convert block/line elements into structured breaks
  clean = clean.replace(/<(?:h[1-6]|div|p|tr|section|article|li)\b[^>]*>/gi, '\n');
  clean = clean.replace(/<br\s*\/?>/gi, '\n');
  clean = clean.replace(/<[^>]+>/g, ' ');

  // Unescape standard HTML entities
  clean = clean
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—');

  // Collapse excessive whitespace while preserving paragraph breaks
  clean = clean
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0)
    .join('\n');

  return clean.trim();
}

/**
 * Extracts plain text from multiple airline document formats:
 * - PDF (.pdf)
 * - Plain Text (.txt)
 * - Markdown (.md, .markdown)
 * - Word Document (.docx)
 * - HTML (.html, .htm)
 */
export const extractText = async (filePath, explicitFileType = null) => {
  const ext = explicitFileType
    ? `.${explicitFileType.replace(/^\./, '').toLowerCase()}`
    : path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf': {
      let pdfParse;
      try {
        const mod = await import('pdf-parse/lib/pdf-parse.js');
        pdfParse = mod.default || mod;
      } catch (err) {
        throw new Error(`PDF parser module not available: ${err.message}`);
      }

      const dataBuffer = await fs.readFile(filePath);
      const data = await pdfParse(dataBuffer);
      const clean = (data.text || '').replace(/\r\n/g, '\n').trim();

      if (!clean) {
        throw new Error('PDF contains no extractable text (empty or scanned image)');
      }

      return {
        text: clean,
        pageCount: data.numpages || 1,
        format: 'pdf'
      };
    }

    case '.docx': {
      try {
        const mammoth = await import('mammoth');
        const result = await (mammoth.default || mammoth).extractRawText({ path: filePath });
        const clean = (result.value || '').replace(/\r\n/g, '\n').trim();

        if (!clean) {
          throw new Error('Word document (.docx) contains no readable text');
        }

        // Estimate pages (~500 words or 3000 chars per page)
        const estimatedPages = Math.max(1, Math.ceil(clean.length / 3000));

        return {
          text: clean,
          pageCount: estimatedPages,
          format: 'docx'
        };
      } catch (err) {
        throw new Error(`Failed to extract text from DOCX: ${err.message}`);
      }
    }

    case '.txt':
    case '.md':
    case '.markdown': {
      const raw = await fs.readFile(filePath, 'utf-8');
      const clean = raw.replace(/\r\n/g, '\n').trim();
      const estimatedPages = Math.max(1, Math.ceil(clean.length / 3000));

      return {
        text: clean,
        pageCount: estimatedPages,
        format: ext.replace('.', '')
      };
    }

    case '.html':
    case '.htm': {
      const raw = await fs.readFile(filePath, 'utf-8');
      const clean = cleanHtml(raw);
      if (!clean) {
        throw new Error('HTML document contains no readable text');
      }
      const estimatedPages = Math.max(1, Math.ceil(clean.length / 3000));

      return {
        text: clean,
        pageCount: estimatedPages,
        format: 'html'
      };
    }

    default:
      throw new Error(`Unsupported file type: ${ext}. Supported formats: PDF, TXT, DOCX, HTML, MD.`);
  }
};
