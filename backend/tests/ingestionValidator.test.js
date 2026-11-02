/**
 * ============================================================================
 * Milestone 3.23 & 3.24: Token-Aware Sizing, Overlap & Corpus Validation Tests
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  IngestionValidator,
  validateCorpusIngestion,
  INGESTION_STATUS,
  DUPLICATE_STRATEGY,
  FAILURE_STAGES,
  computeContentHash,
  countExtractedSections
} from '../src/rag/ingestionValidator.js';

import {
  chunkText,
  normalizeChunkingOptions,
  measureSize,
  DEFAULT_CHUNK_CONFIG
} from '../src/rag/chunker.js';

test('Milestone 3.23 & 3.24: Token-Aware Sizing, Overlap & Corpus Validation', async (t) => {

  await t.test('Token-Aware Chunk Sizing & Strict Limits', async (t2) => {
    await t2.test('should enforce strict token limits on chunks across narrative text', () => {
      const maxTokens = 120;
      const longText = `
        Standard operating procedures require that during pre-flight preparations, flight crews
        review the operational flight plan, verify departure weather minima, assess alternate
        airports, and calculate fuel burn penalties. Fuel density variations must be accounted for
        during refueling operations. Flight dispatch coordinates slot allocation and departure clearances.
        The pilot flying and pilot monitoring must verify navigation database currency and FMC flight plan
        crosscheck procedures before pushback from the gate. Both flight crew members must confirm
        takeoff speeds, flap configuration, and stabilizer trim settings according to the dispatch release.
      `.repeat(3);

      const chunks = chunkText(longText, { maxChunkSize: maxTokens, unit: 'tokens' });

      assert.ok(chunks.length >= 2, `Expected multiple chunks, got ${chunks.length}`);
      for (const chunk of chunks) {
        const tokenSize = measureSize(chunk.text, 'tokens');
        assert.ok(
          tokenSize <= maxTokens,
          `Chunk token size (${tokenSize}) exceeded maxChunkSize (${maxTokens})`
        );
      }
    });

    await t2.test('should normalize options and clamp out-of-bounds parameters safely', () => {
      const normalized = normalizeChunkingOptions({
        maxChunkSize: 200,
        overlap: 350 // Exceeds maxChunkSize!
      });

      assert.equal(normalized.maxChunkSize, 200);
      // Must be capped at floor(maxChunkSize / 2) = 100
      assert.equal(normalized.overlap, 100);
      assert.equal(normalized.unit, 'tokens');
    });

    await t2.test('should handle negative or non-numeric overlap gracefully', () => {
      const normalizedNegative = normalizeChunkingOptions({ maxChunkSize: 300, overlap: -50 });
      assert.equal(normalizedNegative.overlap, 0);

      const normalizedNaN = normalizeChunkingOptions({ maxChunkSize: 300, overlap: 'invalid' });
      assert.equal(normalizedNaN.overlap, DEFAULT_CHUNK_CONFIG.overlap);
    });
  });

  await t.test('Configurable Overlap & Runaway Growth Prevention', async (t2) => {
    await t2.test('should maintain shared boundary context when overlap is configured', () => {
      const text = `
        Alpha procedure step one sets the navigation radios and checks beacon reception.
        Bravo procedure step two confirms autopilot disconnect and manual pitch trim authority.
        Charlie procedure step three configures hydraulics system electric motor pumps.
        Delta procedure step four sets flaps to position fifteen for approach maneuvering.
        Echo procedure step five completes the final landing checklist.
      `.repeat(4);

      const chunks = chunkText(text, {
        strategy: 'fixed_size',
        maxChunkSize: 80,
        overlap: 25,
        unit: 'tokens'
      });

      assert.ok(chunks.length >= 2, 'Should produce multiple chunks');

      // Shared boundary text between chunk 0 and chunk 1
      const sharedPhrase = 'Delta procedure step four';
      assert.ok(
        chunks[0].text.includes(sharedPhrase),
        `Chunk 0 should contain "${sharedPhrase}"`
      );
      assert.ok(
        chunks[1].text.includes(sharedPhrase),
        `Chunk 1 should contain "${sharedPhrase}" due to overlap`
      );
    });

    await t2.test('should prevent repeated overlap from causing runaway chunk growth across successive chunks', () => {
      // Synthetic repetitive corpus designed to stress-test overlap accumulation
      const repetitiveText = `
        WARNING: Terrain ahead. Pull up.
        1. Disengage autopilot and autothrottle immediately.
        2. Apply maximum takeoff thrust and rotate smoothly toward 20 degrees pitch.
        3. Retract speedbrakes and maintain wings level.
        4. Do not change gear or flap configuration until clear of obstacles.
      `.repeat(8);

      const maxTokens = 150;
      const chunks = chunkText(repetitiveText, {
        maxChunkSize: maxTokens,
        overlap: 50,
        unit: 'tokens'
      });

      assert.ok(chunks.length >= 3, `Expected at least 3 chunks, got ${chunks.length}`);

      let previousTokenSize = 0;
      for (let i = 0; i < chunks.length; i++) {
        const currentSize = measureSize(chunks[i].text, 'tokens');
        // Critical safety invariant: Chunk size NEVER exceeds configured max limit
        assert.ok(
          currentSize <= maxTokens,
          `Chunk ${i} size (${currentSize}) exceeded maxTokens (${maxTokens})`
        );
      }
    });
  });

  await t.test('Corpus Ingestion & Validation Metrics', async (t2) => {
    await t2.test('should accurately count processed documents, extracted pages, sections, and chunks', async () => {
      const validator = new IngestionValidator({
        chunkOptions: { maxChunkSize: 150, overlap: 30 }
      });

      const corpus = [
        {
          documentId: 'SOP-OPS-737-01',
          filename: 'sop_sterile_cockpit.txt',
          text: `# Standard Operating Procedures\n## Sterile Cockpit\n1. Below 10,000 feet, non-essential duties prohibited.\n2. Both pilots focus on flight monitoring.`,
          pageCount: 2,
          metadata: {
            title: 'Sterile Cockpit Procedures',
            documentType: 'SOP',
            version: 'Rev 3',
            effectiveDate: '2024-01-01',
            approvalStatus: 'APPROVED',
            approvedBy: 'Chief Pilot'
          }
        },
        {
          documentId: 'QRH-737-02',
          filename: 'qrh_engine_fail.txt',
          text: `# Quick Reference Handbook\n## Engine Failure in Flight\n1. Throttle - Confirm and Close.\n2. Fuel Control Switch - CUTOFF.`,
          pageCount: 1,
          metadata: {
            title: 'Engine Failure Procedure',
            documentType: 'QRH',
            version: 'Rev 5',
            effectiveDate: '2024-02-01',
            approvalStatus: 'APPROVED',
            approvedBy: 'Flight Operations VP'
          }
        }
      ];

      const report = await validator.processCorpus(corpus);

      assert.equal(report.summary.totalDocuments, 2);
      assert.equal(report.summary.processedDocuments, 2);
      assert.equal(report.summary.failedDocuments, 0);
      assert.equal(report.summary.duplicateInputs, 0);
      assert.equal(report.summary.extractedPages, 3); // 2 + 1
      assert.ok(report.summary.extractedSections >= 4); // 2 sections per doc
      assert.ok(report.summary.chunksCreated >= 2);
      assert.equal(report.summary.successRate, 100.0);
      assert.equal(report.failures.length, 0);
    });

    await t2.test('should track metadata uncertainties in metadataValidationSummary', async () => {
      const validator = new IngestionValidator();

      const corpus = [
        {
          documentId: 'DRAFT-NOTE-001',
          filename: 'draft_ops_note.txt',
          text: 'Draft operational briefing notes for review.',
          metadata: {
            title: 'Draft Briefing'
            // Missing effectiveDate, publicationDate, and approval evidence
          }
        }
      ];

      const report = await validator.processCorpus(corpus);

      assert.equal(report.summary.processedDocuments, 1);
      assert.ok(report.summary.metadataErrors >= 2, 'Should count missing date uncertainties');
      assert.ok(
        report.metadataValidationSummary.uncertaintyBreakdown['MISSING_EFFECTIVE_DATE'] >= 1
      );
      assert.ok(
        report.metadataValidationSummary.uncertaintyBreakdown['MISSING_PUBLICATION_DATE'] >= 1
      );
    });
  });

  await t.test('Duplicate Input Handling & Safe Reruns', async (t2) => {
    await t2.test('should detect identical content duplicates and skip by default', async () => {
      const validator = new IngestionValidator({
        duplicateStrategy: DUPLICATE_STRATEGY.SKIP
      });

      const docText = '# Sterile Cockpit\n1. Below 10,000 feet, non-essential communication is prohibited.';

      const corpus = [
        {
          documentId: 'DOC-FIRST-COPY',
          filename: 'sop_original.txt',
          text: docText,
          metadata: { title: 'Sterile Cockpit' }
        },
        {
          documentId: 'DOC-SECOND-COPY',
          filename: 'sop_duplicate.txt',
          text: docText, // Identical content!
          metadata: { title: 'Sterile Cockpit Duplicate' }
        }
      ];

      const report = await validator.processCorpus(corpus);

      assert.equal(report.summary.totalDocuments, 2);
      assert.equal(report.summary.processedDocuments, 1);
      assert.equal(report.summary.duplicateInputs, 1);
      assert.equal(report.duplicates.length, 1);
      assert.equal(report.duplicates[0].matchedBy, 'CONTENT_HASH');
      assert.equal(report.duplicates[0].actionTaken, 'SKIPPED');

      const skippedDoc = report.documents.find(d => d.documentId === 'DOC-SECOND-COPY');
      assert.equal(skippedDoc.status, INGESTION_STATUS.DUPLICATE_SKIPPED);
    });

    await t2.test('should support safe idempotent reruns on the exact same corpus', async () => {
      const validator = new IngestionValidator({
        duplicateStrategy: DUPLICATE_STRATEGY.SKIP
      });

      const doc = {
        documentId: 'SOP-RERUN-TEST',
        filename: 'rerun_test.txt',
        text: '# De-icing Procedure\n1. Verify holdover time before departure.',
        metadata: { title: 'De-icing Standard' }
      };

      // Run 1: First ingestion
      const report1 = await validator.processCorpus([doc]);
      assert.equal(report1.summary.processedDocuments, 1);
      assert.equal(report1.summary.duplicateInputs, 0);

      // Run 2: Re-run ingestion on identical corpus
      const report2 = await validator.processCorpus([doc]);
      assert.equal(report2.summary.processedDocuments, 0);
      assert.equal(report2.summary.duplicateInputs, 1);
      assert.equal(report2.duplicates[0].actionTaken, 'SKIPPED');
    });

    await t2.test('should support DUPLICATE_STRATEGY.UPDATE to refresh existing documents', async () => {
      const validator = new IngestionValidator({
        duplicateStrategy: DUPLICATE_STRATEGY.UPDATE
      });

      const docText = '# Weather Deviation\n1. Notify ATC and request radar heading offset.';
      const doc = {
        documentId: 'SOP-UPDATE-TEST',
        filename: 'update_test.txt',
        text: docText,
        metadata: { title: 'Weather Deviation' }
      };

      await validator.processCorpus([doc]);
      const report = await validator.processCorpus([doc]);

      assert.equal(report.summary.processedDocuments, 1);
      assert.equal(report.summary.duplicateInputs, 1);
      assert.equal(report.duplicates[0].actionTaken, 'UPDATED');
      assert.equal(report.documents[0].status, INGESTION_STATUS.DUPLICATE_UPDATED);
    });

    await t2.test('should fail duplicate when DUPLICATE_STRATEGY.ERROR is configured', async () => {
      const validator = new IngestionValidator({
        duplicateStrategy: DUPLICATE_STRATEGY.ERROR
      });

      const doc = {
        documentId: 'DOC-UNIQUE-01',
        filename: 'unique.txt',
        text: 'Unique procedure content.',
        metadata: { title: 'Unique' }
      };

      await validator.processCorpus([doc]);
      const report = await validator.processCorpus([doc]);

      assert.equal(report.summary.failedDocuments, 1);
      assert.ok(report.failures[0].error.includes('Duplicate document detected'));
    });
  });

  await t.test('Partial Failures & Diagnostic Reporting', async (t2) => {
    await t2.test('should report failed documents honestly and continue processing valid inputs', async () => {
      const validator = new IngestionValidator();

      const corpus = [
        {
          documentId: 'DOC-VALID-01',
          filename: 'valid_sop.txt',
          text: '# Engine Start Checklist\n1. Anti-collision light - ON.\n2. Fuel boost pumps - ON.',
          pageCount: 1,
          metadata: { title: 'Engine Start Checklist' }
        },
        {
          documentId: 'DOC-EMPTY-02',
          filename: 'corrupted_empty.txt',
          text: '   \n\n  \t  ', // Completely empty whitespace
          metadata: { title: 'Empty File' }
        },
        {
          documentId: 'DOC-INVALID-FILE-03',
          filePath: '/non/existent/filesystem/path/missing_sop.pdf',
          metadata: { title: 'Missing PDF' }
        }
      ];

      const report = await validator.processCorpus(corpus);

      // Verify partial failure handling
      assert.equal(report.summary.totalDocuments, 3);
      assert.equal(report.summary.processedDocuments, 1);
      assert.equal(report.summary.failedDocuments, 2);
      assert.equal(report.failures.length, 2);

      // Verify clear failure diagnostics
      const emptyFailure = report.failures.find(f => f.documentId === 'DOC-EMPTY-02');
      assert.ok(emptyFailure, 'Empty file must be present in failures array');
      assert.ok(emptyFailure.error.includes('no extractable text content'));
      assert.equal(emptyFailure.stage, FAILURE_STAGES.TEXT_EXTRACTION);

      const missingFailure = report.failures.find(f => f.filename === 'missing_sop.pdf');
      assert.ok(missingFailure, 'Missing file must be present in failures array');
      assert.equal(missingFailure.stage, FAILURE_STAGES.FILE_LOAD);

      // Valid document must have succeeded
      const validDoc = report.documents.find(d => d.documentId === 'DOC-VALID-01');
      assert.equal(validDoc.status, INGESTION_STATUS.SUCCESS);
      assert.ok(validDoc.chunkCount >= 1);
    });

    await t2.test('should format human-readable Markdown validation report', async () => {
      const validator = new IngestionValidator();

      const corpus = [
        {
          documentId: 'SOP-REPORT-01',
          filename: 'report_sample.txt',
          text: '# Altimeter Setting\n1. Set local altimeter setting.\n2. Crosscheck below 10,000 ft.',
          pageCount: 1,
          metadata: { title: 'Sample SOP' }
        },
        {
          documentId: 'FAIL-SAMPLE-02',
          filename: 'bad_file.txt',
          text: '',
          metadata: { title: 'Bad File' }
        }
      ];

      const report = await validator.processCorpus(corpus);
      const markdown = validator.formatMarkdownReport(report);

      assert.ok(markdown.includes('# AeroRAG Ingestion Validation Report'));
      assert.ok(markdown.includes('Total Documents Submitted | 2'));
      assert.ok(markdown.includes('Processed Successfully | 1'));
      assert.ok(markdown.includes('Failed Documents | 1'));
      assert.ok(markdown.includes('Ingestion Failures (1)'));
      assert.ok(markdown.includes('FAIL-SAMPLE-02'));
    });
  });

  await t.test('Functional API validateCorpusIngestion Integration', async (t2) => {
    await t2.test('should run single-call corpus validation successfully', async () => {
      const report = await validateCorpusIngestion([
        {
          documentId: 'SOP-FUNC-API',
          filename: 'api_test.txt',
          text: '# Flight Control Check\n1. Move control wheel full left and right.\n2. Confirm rudder travel.',
          pageCount: 1,
          metadata: {
            title: 'Flight Control Check',
            version: '1.0',
            effectiveDate: '2024-03-01',
            approvalStatus: 'APPROVED',
            approvedBy: 'Chief Pilot'
          }
        }
      ], {
        chunkOptions: { maxChunkSize: 200, overlap: 40 }
      });

      assert.equal(report.summary.totalDocuments, 1);
      assert.equal(report.summary.processedDocuments, 1);
      assert.equal(report.summary.failedDocuments, 0);
      assert.ok(report.summary.chunksCreated >= 1);
      assert.ok(report.runId.startsWith('INGEST_'));
    });
  });

});
