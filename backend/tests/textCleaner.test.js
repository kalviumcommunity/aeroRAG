import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  cleanText,
  normalizeEncoding,
  normalizeWhitespace,
  removeBoilerplate,
  detectStructure,
  extractQualityMetrics,
  isSafetyCritical,
  isProceduralStep,
  isTableLine,
  TextCleaningPipeline,
  DEFAULT_SAFETY_KEYWORDS,
  DEFAULT_BOILERPLATE_PATTERNS
} from '../src/rag/textCleaner.js';
import { loadDocument } from '../src/rag/documentLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE_CORPUS_DIR = fs.existsSync(path.resolve(__dirname, '../../data/sample_corpus'))
  ? path.resolve(__dirname, '../../data/sample_corpus')
  : path.resolve('data/sample_corpus');

test('Milestone 3.20: Text Extraction and Cleaning Pipeline', async (t) => {

  await t.test('Encoding Normalization', async (t2) => {
    await t2.test('should normalize smart quotes and backticks to standard quotes', () => {
      const input = '“Sterile Cockpit” rule: Pilot’s attention is required. Don‘t talk. `VERIFY` flaps.';
      const { text, anomaliesRepaired } = normalizeEncoding(input);

      assert.equal(text, '"Sterile Cockpit" rule: Pilot\'s attention is required. Don\'t talk. \'VERIFY\' flaps.');
      assert.ok(anomaliesRepaired >= 5, `Expected >= 5 anomalies repaired, got ${anomaliesRepaired}`);
    });

    await t2.test('should normalize em-dashes, en-dashes, and unicode hyphens', () => {
      const input = 'Descent speed—280 KIAS – maintain until 10,000 ft − do not exceed.';
      const { text, anomaliesRepaired } = normalizeEncoding(input);

      assert.equal(text, 'Descent speed-280 KIAS - maintain until 10,000 ft - do not exceed.');
      assert.equal(anomaliesRepaired, 3);
    });

    await t2.test('should strip zero-width spaces, BOM, and null bytes', () => {
      const input = 'Aero\u200B\u200CRAG\uFEFF Flight\x00 Procedure';
      const { text, anomaliesRepaired } = normalizeEncoding(input);

      assert.equal(text, 'AeroRAG Flight Procedure');
      assert.equal(anomaliesRepaired, 4);
    });

    await t2.test('should convert non-breaking spaces to standard spaces', () => {
      const input = 'FL\u00A0350\u202FMACH\u20070.78';
      const { text, anomaliesRepaired } = normalizeEncoding(input);

      assert.equal(text, 'FL 350 MACH 0.78');
      assert.equal(anomaliesRepaired, 3);
    });
  });

  await t.test('Whitespace Normalization & Structure Preservation', async (t2) => {
    await t2.test('should normalize CRLF and CR line breaks to standard LF', () => {
      const input = "Line 1\r\nLine 2\rLine 3\nLine 4";
      const cleaned = normalizeWhitespace(input);

      assert.equal(cleaned, "Line 1\nLine 2\nLine 3\nLine 4");
    });

    await t2.test('should collapse excessive spaces on standard prose while trimming line ends', () => {
      const input = "Step 1:   Thrust levers     to idle.   \nStep 2:   Speedbrake    extend.   ";
      const cleaned = normalizeWhitespace(input);

      assert.equal(cleaned, "Step 1: Thrust levers to idle.\nStep 2: Speedbrake extend.");
    });

    await t2.test('should preserve markdown table pipe structure and column spacing', () => {
      const input = [
        "| Flight Level | Target Speed | Fuel Flow |",
        "|:---:|:---:|:---:|",
        "| FL 370       | 280 KIAS     | 2,400 PPH |",
        "| FL 330       | 290 KIAS     | 2,650 PPH |"
      ].join('\n');

      const cleaned = normalizeWhitespace(input);
      const lines = cleaned.split('\n');

      assert.equal(lines.length, 4);
      assert.ok(lines[0].includes('| Flight Level | Target Speed | Fuel Flow |'));
      assert.ok(lines[2].includes('FL 370'));
      assert.ok(isTableLine(lines[0]));
      assert.ok(isTableLine(lines[1]));
    });

    await t2.test('should cap excessive consecutive blank lines to maximum of 2', () => {
      const input = "Section 1\n\n\n\n\n\n\nSection 2";
      const cleaned = normalizeWhitespace(input);

      assert.equal(cleaned, "Section 1\n\n\nSection 2");
    });
  });

  await t.test('Procedure Numbering & Heading Preservation', async (t2) => {
    await t2.test('should accurately recognize numbered and lettered procedure steps', () => {
      assert.ok(isProceduralStep('1. Oxygen Masks: ON / 100%'));
      assert.ok(isProceduralStep('2. Crew Communications: ESTABLISH'));
      assert.ok(isProceduralStep('1.1 Altitude Selector: SET'));
      assert.ok(isProceduralStep('1.1.2 Verify Altimeter'));
      assert.ok(isProceduralStep('Step 1: Close thrust levers'));
      assert.ok(isProceduralStep('a. Fly to destination'));
      assert.ok(isProceduralStep('b) Fly to alternate'));
      assert.ok(isProceduralStep('(1) Check spoiler handle'));
      assert.ok(isProceduralStep('1. **Oxygen Masks:** ON'));

      // Non-steps should not trigger
      assert.ok(!isProceduralStep('In 2024 the airline updated policies'));
      assert.ok(!isProceduralStep('The captain must ensure safety'));
    });

    await t2.test('should preserve procedure numbering across markdown checklists', () => {
      const checklist = `
# Emergency Descent
1. **Oxygen Masks:** ON / 100%
2. **Crew Communications:** ESTABLISH
3. **Passenger Signs:** ON
4. **Altitude Selector:** SET
5. **Thrust Levers:** CLOSE
6. **Speedbrake Flight Detent:** EXTEND
      `.trim();

      const result = cleanText(checklist);

      assert.equal(result.structure.steps.length, 6);
      assert.ok(result.cleanedText.includes('1. **Oxygen Masks:** ON / 100%'));
      assert.ok(result.cleanedText.includes('6. **Speedbrake Flight Detent:** EXTEND'));
      assert.equal(result.qualityMetrics.numberedStepCount, 6);
    });

    await t2.test('should preserve document headings and procedure titles', () => {
      const doc = `
# QUICK REFERENCE HANDBOOK - QRH-EMER-01
## ANNOUNCE & INITIATE
1. Oxygen masks ON
## LEVEL OFF
Descend to 10,000 ft MSL
      `.trim();

      const result = cleanText(doc);

      assert.ok(result.structure.headings.length >= 3);
      assert.equal(result.qualityMetrics.headingCount, result.structure.headings.length);
      assert.ok(result.cleanedText.includes('# QUICK REFERENCE HANDBOOK'));
      assert.ok(result.cleanedText.includes('## ANNOUNCE & INITIATE'));
      assert.ok(result.cleanedText.includes('## LEVEL OFF'));
    });
  });

  await t.test('Meaningful Warning & Safety Callout Preservation', async (t2) => {
    await t2.test('should identify safety-critical warnings, callouts, and flight limits', () => {
      const w1 = isSafetyCritical('WARNING: Do not extend speedbrake below 1,000 ft AGL');
      assert.equal(w1.isCritical, true);

      const w2 = isSafetyCritical('CAUTION: Structural integrity in doubt - do not exceed current airspeed');
      assert.equal(w2.isCritical, true);

      const w3 = isSafetyCritical('NOTE: Sterile cockpit applies below 10,000 ft MSL');
      assert.equal(w3.isCritical, true);

      const w4 = isSafetyCritical('SET thrust levers to GA detent');
      assert.equal(w4.isCritical, true);

      const w5 = isSafetyCritical('Level off at 10,000 feet MSL or MEA');
      assert.equal(w5.isCritical, true);

      const harmless = isSafetyCritical('Page 14 of 42');
      assert.equal(harmless.isCritical, false);
    });

    await t2.test('should preserve multi-line warning blocks intact', () => {
      const text = `
# Speedbrake Extension Policy

WARNING:
Do not extend flight spoilers beyond flight detent while flaps are deployed.
Structural buffet and loss of pitch authority may occur.

CAUTION:
Verify hydraulic system pressure prior to rapid spoiler deployment.
      `.trim();

      const result = cleanText(text);

      assert.ok(result.cleanedText.includes('WARNING:'));
      assert.ok(result.cleanedText.includes('Structural buffet and loss of pitch authority'));
      assert.ok(result.cleanedText.includes('CAUTION:'));
      assert.ok(result.structure.warnings.length >= 2);
      assert.equal(result.qualityMetrics.warningCount, result.structure.warnings.length);
    });
  });

  await t.test('Boilerplate Removal & Safety Invariant Defense', async (t2) => {
    await t2.test('should safely remove repetitive page numbers, confidentiality, and timestamps', () => {
      const input = `
Page 1 of 12
AERORAG AIRLINE PROCEDURES
CONFIDENTIAL - FOR INTERNAL USE ONLY

1. Oxygen Masks: ON
2. Set MEA or 10,000 ft

Generated on: 2024-03-01 10:00:00 UTC
Page 1 of 12
      `.trim();

      const result = cleanText(input);

      assert.ok(!result.cleanedText.includes('Page 1 of 12'), 'Page number should be removed');
      assert.ok(!result.cleanedText.includes('CONFIDENTIAL - FOR INTERNAL USE ONLY'), 'Confidential footer should be removed');
      assert.ok(!result.cleanedText.includes('Generated on: 2024-03-01'), 'Generation timestamp should be removed');
      assert.ok(result.cleanedText.includes('1. Oxygen Masks: ON'), 'Procedure must be preserved');
      assert.ok(result.cleanedText.includes('2. Set MEA or 10,000 ft'), 'Flight limit must be preserved');
      assert.ok(result.qualityMetrics.boilerplateLinesRemoved >= 3);
    });

    await t2.test('SAFETY INVARIANT: Should NEVER delete candidate boilerplate if it contains a procedure or safety warning', () => {
      const input = `
Page 1 of 5
WARNING: Page 12 - Emergency descent must be initiated immediately upon rapid decompression
Page 1 of 5 - NOTE: Maintain 280 KIAS below FL 100
CONFIDENTIAL
      `.trim();

      const result = cleanText(input, {
        boilerplatePatterns: [
          /page\s*\d+/i, // Aggressive / unanchored pattern simulating over-eager boilerplate filter
          /^confidential/i
        ]
      });

      // Verify that candidate boilerplate lines carrying safety rules were PRESERVED!
      assert.ok(
        result.cleanedText.includes('WARNING: Page 12 - Emergency descent must be initiated immediately'),
        'Safety warning must NOT be deleted even if matching boilerplate regex'
      );
      assert.ok(
        result.cleanedText.includes('NOTE: Maintain 280 KIAS below FL 100'),
        'Flight restriction note must NOT be deleted even if matching boilerplate regex'
      );
      // Plain boilerplate without safety content was safely removed
      assert.ok(!result.cleanedText.includes('CONFIDENTIAL'), 'Pure boilerplate without safety content should be removed');

      // Verify warning telemetry recorded the preservation
      const safetyPreservedWarnings = result.warnings.filter(w => w.code === 'HEADER_PRESERVED_SAFETY');
      assert.ok(safetyPreservedWarnings.length >= 2, `Expected >= 2 safety preservation warnings, got ${safetyPreservedWarnings.length}`);
      assert.ok(result.qualityMetrics.safetyLinesPreserved >= 2);
    });

    await t2.test('should support user-configured boilerplate patterns', () => {
      const input = `
[DISTRIBUTION CODE: FLEET-B737-X]
1. Verify flaps set 15.
[DISTRIBUTION CODE: FLEET-B737-X]
      `.trim();

      const result = cleanText(input, {
        boilerplatePatterns: [/^\s*\[DISTRIBUTION CODE: FLEET-B737-X\]\s*$/i]
      });

      assert.ok(!result.cleanedText.includes('DISTRIBUTION CODE'), 'Custom boilerplate pattern should be stripped');
      assert.ok(result.cleanedText.includes('1. Verify flaps set 15.'), 'Procedure step must be preserved');
      assert.equal(result.qualityMetrics.boilerplateLinesRemoved, 2);
    });
  });

  await t.test('Extraction Quality Reporting & Metrics', async (t2) => {
    await t2.test('should compute detailed metrics and quality score for valid flight procedure', () => {
      const input = `
# Emergency Evacuation Checklist
**Document ID:** EVAC-01

1. Parking Brake: SET
2. Speedbrake Lever: DOWN
3. Flap Lever: 40

WARNING:
Ensure all engines are shutdown before opening overwing exits.
      `.trim();

      const result = cleanText(input);

      assert.ok(result.qualityMetrics.characterCount > 100);
      assert.ok(result.qualityMetrics.wordCount > 20);
      assert.ok(result.qualityMetrics.lineCount > 5);
      assert.equal(result.qualityMetrics.headingCount, 1);
      assert.equal(result.qualityMetrics.numberedStepCount, 3);
      assert.equal(result.qualityMetrics.warningCount, 1);
      assert.ok(result.qualityMetrics.qualityScore >= 85, `Expected qualityScore >= 85, got ${result.qualityMetrics.qualityScore}`);
      assert.equal(result.qualityMetrics.qualityIssues.length, 0);
    });

    await t2.test('should report warnings and reduce score for suspiciously short or empty text', () => {
      const emptyResult = cleanText('');
      assert.equal(emptyResult.qualityMetrics.qualityScore, 0);
      assert.ok(emptyResult.warnings.some(w => w.code === 'EMPTY_TEXT'));

      const shortResult = cleanText('Too short');
      assert.ok(shortResult.qualityMetrics.qualityScore < 80);
      assert.ok(shortResult.warnings.some(w => w.code === 'SUSPICIOUSLY_SHORT'));
    });
  });

  await t.test('Pluggable TextCleaningPipeline Class', async (t2) => {
    await t2.test('should support custom pipeline middleware steps', () => {
      const pipeline = new TextCleaningPipeline();

      // Register custom redaction middleware
      pipeline.use((text, meta) => {
        return text.replace(/SECRET_CODE_\d+/g, '[REDACTED_CODE]');
      });

      const input = `
# Ops Procedure
SECRET_CODE_12345
1. Confirm landing clearance.
      `.trim();

      const result = pipeline.process(input);

      assert.ok(result.cleanedText.includes('[REDACTED_CODE]'));
      assert.ok(!result.cleanedText.includes('SECRET_CODE_12345'));
      assert.ok(result.cleanedText.includes('1. Confirm landing clearance.'));
    });
  });

  await t.test('Integration with Sample Corpus & Document Loader', async (t2) => {
    await t2.test('should clean and produce high-quality metrics for emergency_descent_checklist.md', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'emergency_descent_checklist.md');
      const doc = await loadDocument(filePath);

      assert.ok(doc.text.includes('1. **Oxygen Masks:** ON / 100%'));
      assert.ok(doc.text.includes('6. **Speedbrake Flight Detent:** EXTEND'));
      assert.ok(doc.metadata.qualityMetrics, 'Document should contain quality metrics');
      assert.equal(doc.metadata.qualityMetrics.numberedStepCount, 6);
      assert.ok(doc.metadata.qualityMetrics.qualityScore >= 90);
    });

    await t2.test('should clean and produce high-quality metrics for fuel_reserve_policy.txt', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'fuel_reserve_policy.txt');
      const doc = await loadDocument(filePath);

      assert.ok(doc.text.includes('DISPATCH FUEL RESERVES'));
      assert.ok(doc.text.includes('a. Fly to the destination airport'));
      assert.ok(doc.metadata.qualityMetrics);
      assert.ok(doc.metadata.qualityMetrics.numberedStepCount >= 3);
      assert.ok(doc.metadata.qualityMetrics.qualityScore >= 80);
    });

    await t2.test('should clean and produce high-quality metrics for sop_sterile_cockpit.pdf', async () => {
      const filePath = path.join(SAMPLE_CORPUS_DIR, 'sop_sterile_cockpit.pdf');
      const doc = await loadDocument(filePath);

      assert.ok(doc.text.includes('Sterile Cockpit Procedures'));
      assert.ok(doc.text.includes('below 10,000 ft MSL'));
      assert.ok(doc.metadata.qualityMetrics);
      assert.ok(doc.metadata.qualityMetrics.characterCount > 300);
      assert.ok(doc.metadata.qualityMetrics.qualityScore >= 80);
    });
  });
});
