import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Extracts plain text from multiple document formats:
 * - PDF (.pdf)
 * - Plain Text (.txt)
 * - Markdown (.md, .markdown)
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
        pdfParse = null;
      }

      if (pdfParse) {
        try {
          const dataBuffer = await fs.readFile(filePath);
          const data = await pdfParse(dataBuffer);
          const cleanText = (data.text || '').trim();
          if (!cleanText) {
            throw new Error('PDF contains no extractable text');
          }
          return {
            text: cleanText,
            pageCount: data.numpages || 1,
            format: 'pdf'
          };
        } catch (err) {
          throw new Error(`Corrupted or unreadable PDF: ${err.message}`);
        }
      } else {
        // Fallback using Python pypdf engine
        try {
          const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
          const pyScript = `from pypdf import PdfReader; reader = PdfReader('${normalizedPath}'); text = '\\n'.join(p.extract_text() or '' for p in reader.pages).strip(); print(text if text else 'ERROR_EMPTY')`;
          const output = execSync(`python -c "${pyScript}"`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

          if (output === 'ERROR_EMPTY' || !output) {
            throw new Error('PDF contains no extractable text (empty or scanned image)');
          }

          return {
            text: output,
            pageCount: 1,
            format: 'pdf'
          };
        } catch (pyErr) {
          throw new Error(`Corrupted or unreadable PDF: ${pyErr.message.split('\n')[0]}`);
        }
      }
    }

    case '.txt':
    case '.md':
    case '.markdown': {
      const rawText = await fs.readFile(filePath, 'utf-8');
      return {
        text: rawText.trim(),
        pageCount: 1,
        format: ext.replace('.', '')
      };
    }

    case '.html':
    case '.htm': {
      const rawHtml = await fs.readFile(filePath, 'utf-8');
      // Strip script and style blocks
      let clean = rawHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
      clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
      // Replace tags with space
      clean = clean.replace(/<[^>]+>/g, ' ');
      // Collapse whitespace
      clean = clean.replace(/\s+/g, ' ').trim();

      return {
        text: clean,
        pageCount: 1,
        format: 'html'
      };
    }

    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
};
