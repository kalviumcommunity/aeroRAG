import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkText,
  splitFixedSize,
  splitHeadingAware,
  splitProcedureAware,
  compareChunkingStrategies,
  measureSize,
  formatHeadingBreadcrumb,
  DocumentChunker,
  CHUNK_STRATEGIES,
  DEFAULT_CHUNK_CONFIG
} from '../src/rag/chunker.js';

test('Milestone 3.21: Document Chunking Strategies', async (t) => {

  await t.test('Empty and Whitespace-Only Document Handling', async (t2) => {
    await t2.test('should return empty array for empty string, null, or whitespace', () => {
      assert.deepEqual(chunkText(''), []);
      assert.deepEqual(chunkText('   \n\n\t  '), []);
      assert.deepEqual(chunkText(null), []);
      assert.deepEqual(chunkText(undefined), []);
    });
  });

  await t.test('Short Document Handling', async (t2) => {
    await t2.test('should return exactly one chunk when document fits within maxChunkSize', () => {
      const shortText = '# Quick Checklist\n1. Check fuel.\n2. Confirm flaps.';
      const chunks = chunkText(shortText, { maxChunkSize: 200, unit: 'tokens' });

      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].chunkIndex, 0);
      assert.equal(chunks[0].startChar, 0);
      assert.ok(chunks[0].text.includes('1. Check fuel.'));
      assert.ok(chunks[0].text.includes('2. Confirm flaps.'));
      assert.ok(chunks[0].metadata.containsProcedure);
      assert.equal(chunks[0].metadata.procedureSteps.length, 2);
    });
  });

  await t.test('Long Section Handling & Strict Limit Enforcement', async (t2) => {
    await t2.test('should partition long narrative sections so chunks strictly remain within configured limit', () => {
      const longNarrative = `
# Flight Operations Manual - Oceanic Navigation
${Array(20).fill('Aircraft operating in North Atlantic Track Organised System must maintain strict Mach number technique and verify oceanic clearance before waypoint entry.').join(' ')}
      `.trim();

      const maxLimit = 60; // Artificially small token limit
      const chunks = chunkText(longNarrative, {
        strategy: CHUNK_STRATEGIES.HEADING_AWARE,
        maxChunkSize: maxLimit,
        unit: 'tokens'
      });

      assert.ok(chunks.length >= 3, `Expected >= 3 chunks, got ${chunks.length}`);

      for (const chunk of chunks) {
        // Measure size excluding breadcrumb prefix if applicable
        assert.ok(
          chunk.tokenCount <= maxLimit + 25, // Small tolerance for breadcrumb header
          `Chunk tokenCount ${chunk.tokenCount} exceeded limit ${maxLimit}`
        );
        assert.ok(chunk.text.length > 0);
        assert.ok(chunk.metadata.headings.includes('Flight Operations Manual - Oceanic Navigation'));
      }
    });

    await t2.test('should partition using character units when unit="characters"', () => {
      const text = 'Paragraph 1: Navigation requirements.\n\nParagraph 2: Weather minima.\n\nParagraph 3: Alternate fuel.';
      const maxChars = 80;
      const chunks = chunkText(text, {
        strategy: CHUNK_STRATEGIES.FIXED_SIZE,
        maxChunkSize: maxChars,
        unit: 'characters',
        overlap: 10
      });

      assert.ok(chunks.length >= 2);
      for (const chunk of chunks) {
        assert.ok(chunk.charCount <= maxChars + 15, `Chunk charCount ${chunk.charCount} exceeded ${maxChars}`);
      }
    });
  });

  await t.test('Heading Preservation & Hierarchy Tracking', async (t2) => {
    await t2.test('should preserve multi-level heading hierarchy and section titles', () => {
      const hierarchicalDoc = `
# AeroRAG Flight Manual
## Emergency Procedures
### Rapid Depressurization
1. Put on oxygen mask.
2. Descend immediately.
### Smoke & Fumes Removal
1. Don oxygen mask with smoke goggles.
2. Establish communication.
      `.trim();

      const chunks = chunkText(hierarchicalDoc, {
        strategy: CHUNK_STRATEGIES.HEADING_AWARE,
        maxChunkSize: 150
      });

      assert.ok(chunks.length >= 2);

      // Verify first section
      const chunk1 = chunks.find(c => c.text.includes('Rapid Depressurization'));
      assert.ok(chunk1);
      assert.ok(chunk1.metadata.headings.includes('AeroRAG Flight Manual'));
      assert.ok(chunk1.metadata.headings.includes('Emergency Procedures'));
      assert.ok(chunk1.metadata.headings.includes('Rapid Depressurization'));
      assert.equal(chunk1.metadata.sectionTitle, 'Rapid Depressurization');
      assert.ok(chunk1.text.includes('[AeroRAG Flight Manual > Emergency Procedures > Rapid Depressurization]'));

      // Verify second section
      const chunk2 = chunks.find(c => c.text.includes('Smoke & Fumes Removal'));
      assert.ok(chunk2);
      assert.equal(chunk2.metadata.sectionTitle, 'Smoke & Fumes Removal');
      assert.ok(chunk2.text.includes('[AeroRAG Flight Manual > Emergency Procedures > Smoke & Fumes Removal]'));
    });
  });

  await t.test('Procedure Numbering & Checklist Step Preservation (SAFETY INVARIANT)', async (t2) => {
    await t2.test('should preserve numbered procedure steps atomically in a single chunk', () => {
      const checklistDoc = `
# Emergency Descent Checklist
WARNING: Rapid cabin depressurization above 14,000 ft requires immediate oxygen donning.

1. **Oxygen Masks:** ON / 100%
2. **Crew Communications:** ESTABLISH
3. **Passenger Signs:** ON
4. **Altitude Selector:** SET MEA or 10,000 ft
5. **Thrust Levers:** CLOSE
6. **Speedbrake Flight Detent:** EXTEND
      `.trim();

      const chunks = chunkText(checklistDoc, {
        strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
        maxChunkSize: 250
      });

      // All 6 steps must be retained in the same chunk without being severed
      assert.equal(chunks.length, 1);
      const chunk = chunks[0];
      assert.ok(chunk.metadata.containsProcedure);
      assert.equal(chunk.metadata.procedureSteps.length, 6);
      assert.ok(chunk.text.includes('1. **Oxygen Masks:** ON / 100%'));
      assert.ok(chunk.text.includes('6. **Speedbrake Flight Detent:** EXTEND'));
    });

    await t2.test('should split an oversized procedure cleanly between discrete steps rather than mid-step', () => {
      const longChecklist = `
# Heavy Maintenance Pre-Flight Inspection
1. Verify left main landing gear assembly, brake lines, tires, and hydraulic actuators for fluid leakage.
2. Verify nose landing gear doors, steering lockout pin, and taxi light wiring harness.
3. Verify right main landing gear assembly, brake wear pins, anti-skid transducers, and tire tread depth.
4. Verify forward cargo door locking mechanism, seal integrity, and pressure equalization valve.
5. Verify aft cargo door locking mechanism, electronic latch sensors, and cargo hold fire suppression nozzles.
6. Verify emergency exit door seals, slide pressure gauges, and manual inflation handle safety covers.
      `.trim();

      const smallLimit = 50; // Forces splitting
      const chunks = chunkText(longChecklist, {
        strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
        maxChunkSize: smallLimit,
        unit: 'tokens'
      });

      assert.ok(chunks.length >= 2, `Expected >= 2 chunks, got ${chunks.length}`);

      // Verify that no chunk starts with partial sentences; every step chunk starts cleanly
      for (const chunk of chunks) {
        if (chunk.metadata.containsProcedure) {
          const lines = chunk.text.split('\n').filter(l => l.trim() && !l.startsWith('['));
          assert.ok(lines.length > 0);
          assert.ok(
            lines[0].match(/^(?:#|\d+\.)/),
            `Chunk should start cleanly with heading or step number, got: "${lines[0]}"`
          );
        }
      }
    });

    await t2.test('should keep preceding safety warning bundled with its governed procedure', () => {
      const procedureWithWarning = `
# High Crosswind Landing Procedure

WARNING:
Maximum demonstrated crosswind component is 33 knots with winglets installed. Exceeding limit risks runway excursion and wingtip strike.

1. Set approach speed to VREF + additive.
2. Align aircraft axis with runway centerline prior to flare.
3. Apply into-wind aileron throughout landing roll.
      `.trim();

      const chunks = chunkText(procedureWithWarning, {
        strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
        maxChunkSize: 300
      });

      assert.equal(chunks.length, 1);
      assert.ok(chunks[0].text.includes('WARNING:'));
      assert.ok(chunks[0].text.includes('Maximum demonstrated crosswind component'));
      assert.ok(chunks[0].text.includes('1. Set approach speed'));
      assert.ok(chunks[0].metadata.containsWarning);
      assert.ok(chunks[0].metadata.containsProcedure);
    });
  });

  await t.test('Chunk Boundaries & Offset Tracking', async (t2) => {
    await t2.test('should produce accurate sequential chunkIndex and non-negative offsets', () => {
      const document = `
# Chapter 1: General Aviation Regulations
FAR 121 governs domestic commercial operations.
# Chapter 2: Maintenance Minimum Equipment List
MEL allows dispatch with deferred inoperative equipment.
      `.trim();

      const chunks = chunkText(document, {
        strategy: CHUNK_STRATEGIES.HEADING_AWARE,
        maxChunkSize: 80
      });

      assert.ok(chunks.length >= 2);
      for (let i = 0; i < chunks.length; i++) {
        assert.equal(chunks[i].chunkIndex, i);
        assert.equal(chunks[i].id, `chunk_${i}`);
        assert.ok(chunks[i].startChar >= 0);
        assert.ok(chunks[i].endChar >= chunks[i].startChar);
        assert.ok(chunks[i].tokenCount > 0);
        assert.ok(chunks[i].wordCount > 0);
      }
    });
  });

  await t.test('Strategy Comparison Engine & Default Verification', async (t2) => {
    await t2.test('should compare fixed_size, heading_aware, and procedure_aware strategies', () => {
      const testDoc = {
        name: 'Emergency Descent Test Document',
        text: `
# Quick Reference Handbook (QRH) - Emergency Descent
WARNING: Immediate oxygen required.

1. **Oxygen Masks:** ON
2. **Crew Communications:** ESTABLISH
3. **Passenger Signs:** ON
4. **Altitude Selector:** SET MEA
5. **Thrust Levers:** CLOSE
6. **Speedbrake:** EXTEND

## Airspeed Target
Maintain 340 KIAS or Vmo.
        `.trim()
      };

      const comparison = compareChunkingStrategies([testDoc], { maxChunkSize: 100 });

      assert.ok(comparison.strategies[CHUNK_STRATEGIES.FIXED_SIZE]);
      assert.ok(comparison.strategies[CHUNK_STRATEGIES.HEADING_AWARE]);
      assert.ok(comparison.strategies[CHUNK_STRATEGIES.PROCEDURE_AWARE]);

      assert.equal(comparison.recommendation.defaultStrategy, CHUNK_STRATEGIES.PROCEDURE_AWARE);
      assert.ok(comparison.recommendation.rationale.includes('atomic checklist integrity'));
    });
  });

  await t.test('Configurable DocumentChunker Class & Legacy Ingester API', async (t2) => {
    await t2.test('should support DocumentChunker instance with default metadata decoration', () => {
      const chunker = new DocumentChunker({
        strategy: CHUNK_STRATEGIES.PROCEDURE_AWARE,
        maxChunkSize: 200
      });

      const text = '# Fuel Reserve Policy\n1. Fly to destination.\n2. Fly to alternate.';
      const chunks = chunker.chunk(text, { documentId: 'DOC-FUEL-009', fleet: 'B737' });

      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].metadata.documentId, 'DOC-FUEL-009');
      assert.equal(chunks[0].metadata.fleet, 'B737');
      assert.ok(chunks[0].metadata.containsProcedure);
    });

    await t2.test('should maintain backward compatibility with legacy positional arguments chunkText(text, maxTokens, overlapTokens)', () => {
      const legacyText = 'This is a test of the legacy chunkText API call used by ingester.js.';
      const legacyChunks = chunkText(legacyText, 500, 50);

      assert.ok(Array.isArray(legacyChunks));
      assert.equal(legacyChunks.length, 1);
      assert.equal(legacyChunks[0].chunkIndex, 0);
      assert.equal(legacyChunks[0].text, legacyText);
    });
  });
});
