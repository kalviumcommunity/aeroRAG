# Text Extraction and Cleaning Pipeline Guide

> **Milestone:** 3.20 — Text extraction and cleaning pipeline  
> **System:** AeroRAG Airline Procedure Intelligence  
> **Module:** `backend/src/rag/textCleaner.js` (integrated into `documentLoader.js` & `textExtractor.js`)

---

## 1. Overview & Operational Mandate

In commercial aviation operations, documentation from airframers (Boeing, Airbus) and regulators (FAA, EASA, ICAO) is subject to diverse document formatting artifacts:
- Embedded carriage returns (`\r\n`), non-breaking spaces, and zero-width spaces.
- Smart quotes and Unicode typography (`“”`, `‘’`, `—`) that impair tokenization and semantic search.
- Repetitive headers, footers, pagination strings (`Page 14 of 42`), and confidentiality disclaimers.
- Critical procedure numbering (`1.`, `Step 1:`, `a.`) and safety callouts (`WARNING:`, `CAUTION:`) that must **never** be inadvertently deleted or truncated.

Milestone 3.20 establishes a deterministic, multi-stage text cleaning pipeline that normalizes whitespace and encoding, strips repetitive boilerplate safely, preserves all procedural and safety elements, and produces detailed extraction-quality telemetry.

---

## 2. The Multi-Stage Cleaning Architecture

```
                  ┌────────────────────────────────────────┐
                  │          Raw Extracted Text            │
                  └──────────────────┬─────────────────────┘
                                     │
                  ┌──────────────────▼─────────────────────┐
                  │ 1. Encoding Normalization              │
                  │    • Unicode NFC canonical form        │
                  │    • Smart quotes & dashes -> ASCII   │
                  │    • Null bytes & zero-width stripped  │
                  └──────────────────┬─────────────────────┘
                                     │
                  ┌──────────────────▼─────────────────────┐
                  │ 2. Whitespace & Table Normalization    │
                  │    • Line endings -> standard LF (\n)  │
                  │    • Excessive horizontal spaces collapsed │
                  │    • Pipe/column table alignment preserved │
                  │    • Excessive line voids capped at 2  │
                  └──────────────────┬─────────────────────┘
                                     │
                  ┌──────────────────▼─────────────────────┐
                  │ 3. Boilerplate Stripping w/ Safety Guard│
                  │    • Page numbers, footers, timestamps │
                  │    • SAFETY INVARIANT EVALUATION       │
                  └──────────────────┬─────────────────────┘
                                     │
                  ┌──────────────────▼─────────────────────┐
                  │ 4. Structural Detection & Quality Audit│
                  │    • Headings, steps, warnings, tables │
                  │    • Quality metrics & score (0-100)   │
                  └──────────────────┬─────────────────────┘
                                     │
                  ┌──────────────────▼─────────────────────┐
                  │ Standardized Cleaned Document Record   │
                  │ (cleanedText, metrics, warnings)       │
                  └────────────────────────────────────────┘
```

---

## 3. Cleaning Stages & Normalization Specifications

### 3.1 Encoding Normalization (`normalizeEncoding`)
* **Unicode Canonical Form:** Decomposes and recomposes Unicode strings using standard `NFC` (`String.prototype.normalize('NFC')`).
* **Smart Quotes:** Normalizes curly double quotes (`“`, `”`, `„`, `«`, `»`) to standard `"` and curly single quotes/apostrophes (`‘`, `’`, `‚`, `‛`, `` ` ``) to standard `'`.
* **Dashes & Hyphens:** Normalizes em-dashes (`—`), en-dashes (`–`), minus signs (`−`), and horizontal bars (`―`) to standard `-`.
* **Invisible Spacing:** Strips zero-width spaces (`\u200B`, `\u200C`, `\u200D`) and Byte Order Marks (`\uFEFF`).
* **Non-Breaking Spaces:** Converts non-breaking and ideographic spaces (`\u00A0`, `\u202F`, `\u2007`, `\u3000`) into standard single spaces (`0x20`).
* **Control Characters:** Purges ASCII null bytes (`\x00`) and unprintable control characters while preserving valid formatting (`\n`, `\r`, `\t`).

### 3.2 Whitespace & Structural Normalization (`normalizeWhitespace`)
* **Consistent Line Endings:** Replaces all CRLF (`\r\n`) and classic Mac CR (`\r`) sequences with standard Unix LF (`\n`).
* **Table Spacing Preservation:** Markdown pipe tables (`| col1 | col2 |`), tab-delimited columns, and multi-column fixed-width rows are detected and preserved with internal column alignments intact.
* **Prose Space Collapsing:** Non-table horizontal whitespace clusters (`[ \t]{2,}`) are collapsed to a single space.
* **Line Void Capping:** Caps consecutive empty lines to a maximum of 2, eliminating document voids caused by page breaks while maintaining clean paragraph and section boundaries.
* **Trailing Trimming:** Trims right-hand whitespace per line.

---

## 4. Preservation of Critical Aviation Structures

### 4.1 Procedure Numbering & Hierarchies
Procedural steps must maintain strict sequential integrity for flight crew execution. The pipeline recognizes:
- Standard numbered steps: `1.`, `2.`, `1.1`, `1.1.2.`, `(1)`, `[1]`, `1)`.
- Lettered sub-steps: `a.`, `b.`, `c.`, `(a)`, `[b]`, `a)`.
- Explicit step markers: `Step 1:`, `STEP 2 -`.
- Markdown emphasis steps: `1. **Oxygen Masks:** ON / 100%`.

### 4.2 Document Headings & Section Boundaries
Preserves both Markdown header tags (`#`, `##`, `###`) and all-caps aviation procedure headers (`QUICK REFERENCE HANDBOOK`, `STANDARD OPERATING PROCEDURE: DISPATCH FUEL RESERVES`).

### 4.3 Warnings, Cautions, and Flight Limits
Preserves critical aviation callouts (`WARNING:`, `CAUTION:`, `NOTE:`, `DANGER:`, `MANDATORY:`) and boxed or multi-line warning blocks intact without truncation.

---

## 5. The Safety Invariant: Boilerplate Removal Defense

> [!IMPORTANT]
> **Safety Invariant:** Never delete text solely because it resembles a header or footer if doing so could remove an operational procedure, safety warning, or flight limit.

Flight manuals frequently interleave running headers or footers with procedural notes (e.g. `Page 1 of 5 - NOTE: Maintain 280 KIAS below FL 100` or `WARNING: Page 12 - Emergency descent must be initiated immediately`).

Before any candidate line matching a boilerplate pattern is deleted, `isSafetyCritical()` evaluates:
1. **Safety Warning Keywords:** Does the line contain `WARNING`, `CAUTION`, `NOTE`, `DANGER`, `MANDATORY`, `EMERGENCY`, or `RESTRICTION`?
2. **Procedural Action Verbs:** Does the line begin with an operational command verb (`SET`, `VERIFY`, `CLOSE`, `EXTEND`, `DISENGAGE`, `CALL`, `MONITOR`, `CHECK`)?
3. **Numbered Steps:** Does the line define a numbered or lettered checklist item?
4. **Flight Constraints:** Does the line reference altitude, airspeed, or aircraft limits (`ft`, `FL`, `KIAS`, `Vmo`, `Mmo`, `detent`, `thrust levers`)?

If **any** safety or procedural condition is met:
- The line is **strictly preserved** in the document.
- An informative telemetry warning is recorded:
  ```json
  {
    "code": "HEADER_PRESERVED_SAFETY",
    "message": "Preserved candidate boilerplate line because it contains safety or procedure content: \"...\"",
    "severity": "INFO"
  }
  ```

---

## 6. Extraction Quality Metrics & Telemetry

Every cleaning run computes comprehensive quality metrics (`extractQualityMetrics`):

```typescript
interface QualityMetrics {
  characterCount: number;         // Cleaned character count
  wordCount: number;              // Cleaned word count
  lineCount: number;              // Total line count
  paragraphCount: number;         // Distinct paragraph count
  headingCount: number;           // Count of recognized headings
  numberedStepCount: number;      // Count of numbered checklist steps
  warningCount: number;           // Count of safety warnings/cautions
  tableCount: number;             // Count of recognized tables
  boilerplateLinesRemoved: number;// Count of non-safety boilerplate lines stripped
  safetyLinesPreserved: number;   // Count of candidate lines protected by safety invariant
  encodingAnomaliesRepaired: number; // Count of fixed smart quotes, dashes, spaces
  reductionRatio: number;         // (rawLength - cleanedLength) / rawLength
  qualityScore: number;           // Calculated score (0 - 100)
  qualityIssues: string[];        // Diagnostic issue flags
}
```

### Quality Score Calculation
- Baseline: **100 points**
- Penalties:
  - Empty text: score set to `0`.
  - Suspiciously short text (< 80 chars): `-30 points`.
  - Excessive boilerplate reduction (> 70% stripped): `-20 points`.
  - Complete absence of procedural structure: `-15 points`.
- Structure Bonuses:
  - Numbered steps present: `+5 points`.
  - Safety warnings present: `+5 points`.
  - Headings present: `+5 points`.

---

## 7. Usage Examples

### 7.1 Standalone Cleaning
```javascript
import { cleanText } from './src/rag/textCleaner.js';

const raw = `
Page 1 of 5
CONFIDENTIAL
# Emergency Descent
1. **Oxygen Masks:** ON / 100%
WARNING: Page 12 - Descend at Vmo / Mmo.
`;

const result = cleanText(raw);

console.log(result.cleanedText);
// Preserves # Emergency Descent, 1. **Oxygen Masks**, and WARNING
// Strips pure boilerplate: "Page 1 of 5", "CONFIDENTIAL"

console.log(`Quality Score: ${result.qualityMetrics.qualityScore}/100`);
console.log(`Steps Detected: ${result.qualityMetrics.numberedStepCount}`);
console.log(`Warnings Detected: ${result.qualityMetrics.warningCount}`);
```

### 7.2 Custom Pipeline Middleware
```javascript
import { TextCleaningPipeline } from './src/rag/textCleaner.js';

const pipeline = new TextCleaningPipeline();

pipeline.use((text, context) => {
  return text.replace(/TAIL_NUMBER_\w+/g, '[REDACTED_TAIL]');
});

const result = pipeline.process(rawDocumentText);
```

### 7.3 Integration with Document Loading
```javascript
import { loadDocument } from './src/rag/documentLoader.js';

const doc = await loadDocument('data/sample_corpus/emergency_descent_checklist.md');
console.log(doc.metadata.qualityMetrics);
```
