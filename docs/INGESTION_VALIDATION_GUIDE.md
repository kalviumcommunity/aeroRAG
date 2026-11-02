# Airline Procedure Intelligence: Token-Aware Sizing, Overlap & Ingestion Validation Guide

## Milestones 3.23 & 3.24 — Token-Aware Sizing, Overlap & Corpus Validation

Ingesting flight operations manuals, SOPs, and emergency checklists into an enterprise RAG assistant requires deterministic chunk boundaries, strict token limit enforcement, bounded overlap, and resilient batch validation. Silently skipping failed files or duplicating chunks during ingestion reruns compromises operational integrity.

This guide details the token-aware chunk sizing limits, overlap runaway growth defense, duplicate detection strategies, partial failure reporting, and corpus validation reports implemented in **Milestones 3.23 & 3.24**.

---

## 1. Token-Aware Chunk Limits & Overlap Runaway Growth Defense

### Token-Aware Chunk Limits
The chunker measures chunk size strictly in tokens (or configured units) using `measureSize(text, 'tokens')`.
Every produced chunk is bounded by `maxChunkSize` (default: 400 tokens).

### Overlap Boundary & Runaway Growth Defense
When sliding windows or section sub-splits apply overlap:
1. **Overlap Upper Bound:**
   $$\text{overlap} \le \left\lfloor \frac{\text{maxChunkSize}}{2} \right\rfloor$$
   If a caller specifies an overlap larger than half the chunk size (e.g. `overlap: 400` with `maxChunkSize: 150`), `normalizeChunkingOptions` automatically caps overlap at `floor(maxChunkSize / 2) = 75`.
2. **Anti-Accumulation Invariant:**
   Overlap carried from chunk $N$ reduces available capacity for fresh content in chunk $N+1$:
   $$\text{availableFreshCapacity} = \text{maxChunkSize} - \text{overlapSize} - \text{breadcrumbSize}$$
   This guarantees that `overlap + freshContent + breadcrumb <= maxChunkSize` on every single emitted chunk.
3. **Guaranteed Forward Progress:**
   In sliding word windows, the window always advances by at least $\max(1, \lfloor \text{words} / 2 \rfloor)$. This prevents deadlocks, zero-progress loops, and snowballing chunk expansion across repetitive text.

---

## 2. Ingestion Validation Report Schema

When processing a corpus of documents via `validateCorpusIngestion` or `IngestionValidator`, the engine produces a structured audit report:

```typescript
interface IngestionValidationReport {
  runId: string;               // e.g. "INGEST_1730534400_A9B2C"
  timestamp: string;           // ISO 8601 string
  durationMs: number;          // Total execution time in ms
  summary: {
    totalDocuments: number;    // Total input documents submitted
    processedDocuments: number;// Successfully parsed & chunked
    failedDocuments: number;   // Failed documents
    duplicateInputs: number;   // Duplicate inputs detected
    chunksCreated: number;     // Total chunks generated
    extractedPages: number;    // Total pages extracted across documents
    extractedSections: number; // Total sections/headings identified
    metadataErrors: number;    // Metadata uncertainties/errors flagged
    successRate: number;       // Percentage (e.g. 95.0%)
  };
  documents: Array<{
    documentId: string;
    filename: string;
    virtualPath: string;
    status: 'SUCCESS' | 'FAILED' | 'DUPLICATE_SKIPPED' | 'DUPLICATE_UPDATED';
    pageCount: number;
    sectionCount: number;
    chunkCount: number;
    contentHash: string;       // SHA-256 of cleaned text
    metadata: DocumentMetadata;
    errors: string[];
    warnings: string[];
  }>;
  failures: Array<{
    documentId: string;
    filename: string;
    stage: 'INPUT_VALIDATION' | 'FILE_LOAD' | 'TEXT_EXTRACTION' | 'TEXT_CLEANING' | 'METADATA_VALIDATION' | 'CHUNKING';
    error: string;
    fatal: boolean;
  }>;
  duplicates: Array<{
    documentId: string;
    filename: string;
    matchedBy: 'CONTENT_HASH' | 'DOCUMENT_ID';
    duplicateOf: string;
    actionTaken: 'SKIPPED' | 'UPDATED' | 'ERROR';
  }>;
  metadataValidationSummary: {
    totalUncertainties: number;
    uncertaintyBreakdown: Record<string, number>;
  };
}
```

---

## 3. Partial Failure Resilience & Non-Silent Failure Reporting

A single corrupted or unsupported document must **never** abort an entire corpus ingestion run, nor should it be silently ignored.

- **Non-Silent Diagnostics:**
  - If a file is missing, empty, or unreadable, the error is captured in `report.failures` with the exact pipeline stage (`FILE_LOAD`, `TEXT_EXTRACTION`, etc.) and error diagnostics.
  - The document status is set to `FAILED`.
  - `failedDocuments` is incremented.
- **Partial Processing:**
  - Remaining valid documents in the corpus continue to be loaded, cleaned, validated, and chunked normally.

---

## 4. Duplicate Handling & Safe Reruns (Idempotency)

The engine computes a SHA-256 hash (`contentHash`) of cleaned text and maintains an in-memory document registry.

Three configurable duplicate strategies are supported (`DUPLICATE_STRATEGY`):

| Strategy | Behavior on Duplicate | Use Case |
| :--- | :--- | :--- |
| **`SKIP`** *(Default)* | Skips chunk creation, retains existing chunks, marks `DUPLICATE_SKIPPED`, increments `duplicateInputs`. | Safe idempotent batch reruns without duplicating vectors. |
| **`UPDATE`** | Re-cleans, re-validates, and re-chunks document, marks `DUPLICATE_UPDATED`, increments `duplicateInputs`. | Manual revision updates and content refreshes. |
| **`ERROR`** | Fails document immediately, marks `FAILED`, records failure diagnostics in `report.failures`. | Strict compliance audits where duplicate uploads violate policy. |

### Safe Rerun Guarantee
Running `validateCorpusIngestion(corpus, { duplicateStrategy: 'SKIP' })` twice on identical inputs produces:
- First run: `processedDocuments: N`, `duplicateInputs: 0`.
- Second run: `processedDocuments: 0`, `duplicateInputs: N`, `chunksCreated: 0`.
No duplicate chunks are created and the vector store is not corrupted.

---

## 5. Usage Example

```javascript
import { validateCorpusIngestion, IngestionValidator, DUPLICATE_STRATEGY } from './src/rag/ingestionValidator.js';

// Batch corpus validation
const report = await validateCorpusIngestion([
  'documents/sop_sterile_cockpit.pdf',
  'documents/qrh_engine_failure.docx',
  {
    documentId: 'SOP-OPS-737-04',
    filename: 'sop_altimeter.txt',
    text: '# Altimeter Setting\n1. Crosscheck altimeters below 10,000 ft.',
    pageCount: 1,
    metadata: {
      title: 'Altimeter Procedures',
      version: 'Rev 4',
      effectiveDate: '2024-03-01',
      approvalStatus: 'APPROVED',
      approvedBy: 'Chief Pilot'
    }
  }
], {
  duplicateStrategy: DUPLICATE_STRATEGY.SKIP,
  chunkOptions: { maxChunkSize: 250, overlap: 40 }
});

console.log(report.summary);
// Output: { totalDocuments: 3, processedDocuments: 3, failedDocuments: 0, duplicateInputs: 0, chunksCreated: 12, ... }

// Print Markdown report
const validator = new IngestionValidator();
console.log(validator.formatMarkdownReport(report));
```
