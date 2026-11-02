# Document Chunking Strategies Guide

> **Milestone:** 3.21 — Document chunking strategies  
> **System:** AeroRAG Airline Procedure Intelligence  
> **Module:** `backend/src/rag/chunker.js`  
> **Benchmark Script:** `backend/scripts/compare_chunking_strategies.js`  
> **Evaluation Results:** [`docs/chunking_strategy_comparison.md`](chunking_strategy_comparison.md) & [`docs/chunking_strategy_comparison.json`](chunking_strategy_comparison.json)

---

## 1. Overview & Operational Mandate

In airline flight operations, Quick Reference Handbooks (QRHs), Standard Operating Procedures (SOPs), and Flight Crew Operations Manuals (FCOMs) are not typical narrative prose. They contain:
- Strict sequential action steps (e.g. *1. Oxygen Masks: ON*, *2. Altitude: SET MEA*).
- Crucial safety warnings and cautions governing immediate actions.
- Multi-level system and phase-of-flight hierarchies (e.g. *QRH > Fire Protection > APU Fire Checklist*).
- Aeronautical speed/altitude limitations and tabular reference matrices.

A naive sliding-window text chunker poses catastrophic flight-safety risks:
- Dividing a 6-step checklist in half so retrieval returns steps 1–3 without steps 4–6.
- Stranding a `WARNING` block in a separate chunk from the checklist it governs.
- Stripping section titles so the LLM cannot ascertain whether a procedure applies to *Normal Approach* or *Single-Engine Go-Around*.

Milestone 3.21 implements configurable chunking strategies designed for operational aviation documents, establishes a strict **Safety Invariant** preventing the destruction of procedure context, and benchmarks strategies across representative synthetic operational documents.

---

## 2. Chunking Strategies Architecture

AeroRAG provides three distinct chunking strategies governed by a unified interface:

```
                            ┌────────────────────────┐
                            │    Raw Document Text   │
                            └───────────┬────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
  ┌────────▼─────────┐        ┌─────────▼──────────┐       ┌─────────▼──────────┐
  │ 1. Fixed-Size    │        │ 2. Heading-Aware   │       │ 3. Procedure-Aware │
  │ Sliding Window   │        │ Hierarchical       │       │ Safety-Guarded     │
  │                  │        │                    │       │ (CHOSEN DEFAULT)   │
  │ • Word boundary  │        │ • Splits by #, ##  │       │ • Atomic checklist │
  │ • Token overlap  │        │ • Breadcrumbs:     │       │ • Warning binding  │
  │ • Raw baseline   │        │   [Parent > Child] │       │ • Step continuity  │
  └────────┬─────────┘        └─────────┬──────────┘       └─────────┬──────────┘
           │                            │                            │
           └────────────────────────────┼────────────────────────────┘
                                        │
                            ┌───────────▼────────────┐
                            │ Standardized Chunk DTO │
                            │ (id, text, metadata)   │
                            └────────────────────────┘
```

### Strategy Summary Table

| Strategy | Token/Char Sizing | Heading Context | Checklist Integrity | Warning Association | Recommended Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `FIXED_SIZE` | Configurable window with overlap | None (Raw window) | Poor (Arbitrary splits) | Poor (Isolated) | Baseline benchmark |
| `HEADING_AWARE` | Dynamic by section; sub-splits oversized | Full breadcrumb stack | Moderate | Moderate | Long technical policy documents |
| `PROCEDURE_AWARE` *(Default)* | Dynamic bounded by procedure units | Full breadcrumb stack | **Complete (Atomic)** | **Complete (Bound to Steps)** | **Operational SOPs, QRHs, & Checklists** |

---

## 3. The Safety Invariant: Procedure & Warning Preservation

> [!IMPORTANT]
> **Safety Invariant:** Avoid splitting a numbered procedure in ways that destroy essential context wherever feasible. Keep safety warnings attached to the procedural steps they govern.

When evaluating checklists and operational procedures:
1. **Atomic Step Groups:** Steps 1 through $N$ are treated as a cohesive unit. If the entire checklist fits within `maxChunkSize`, it is guaranteed to remain in a single chunk.
2. **Discrete Step Boundary Splitting:** If a procedure is extraordinarily long and exceeds `maxChunkSize`, the partition occurs strictly **between discrete steps** (e.g. after Step 4, before Step 5) rather than mid-sentence, mid-callout, or splitting an action item from its response.
3. **Warning Co-occurrence Binding:** `WARNING` and `CAUTION` blocks immediately preceding a procedure are bound to the procedure chunk, ensuring retrieval always presents hazards alongside actions.
4. **Heading Breadcrumb Injection:** Every chunk is injected with its full ancestry breadcrumb (e.g. `[Quick Reference Handbook > Emergency Descent > Announce & Initiate]`), providing dense embedding vectors with critical contextual anchors.

---

## 4. Benchmark & Strategy Comparison Results

All three strategies were rigorously compared across three representative synthetic documents:
1. `synthetic_qrh_emergency_descent.md`: QRH multi-level checklist with hypoxia warnings and 8 sequential steps.
2. `synthetic_etops_diversion_policy.md`: Extended twin-engine operations policy with dispatch minima and critical fuel scenarios.
3. `synthetic_abnormal_flap_asymmetry.md`: FCOM abnormal checklist with speed limits table and roll control callouts.

*Benchmark Configuration: `maxChunkSize = 250 tokens`, `overlap = 30 tokens`*

### Quantitative Benchmark Results

| Metric | Fixed-Size Window | Heading-Aware | Procedure-Aware (Default) |
| :--- | :--- | :--- | :--- |
| **Total Chunks Produced** | 6 | 14 | **7** |
| **Average Tokens / Chunk** | 210.0 | 106.0 | **191.3** |
| **Average Chars / Chunk** | 759.5 | 383.2 | **691.6** |
| **Size Std Deviation (Tokens)** | 56.0 | 52.5 | **31.8 (Most Uniform)** |
| **Procedures Severed / Split** | High (Arbitrary cutoffs) | Moderate | **0 (Zero Severed)** |
| **Warning Co-occurrence** | Poor (Often Isolated) | Fair | **100% (Bound to Steps)** |
| **Heading Context Preservation** | None (Raw Window) | Complete (Hierarchical) | **Complete (Hierarchical)** |

### Operational Rationale for Chosen Default (`procedure_aware`)
- **Zero Procedure Truncation:** Checklists are never severed mid-step, eliminating the hazard of partial instructions.
- **Consistent Chunk Capacity:** Produces a standard deviation of 31.8 tokens (vs 56.0 for fixed-size and 52.5 for heading-aware), maximizing context window efficiency for the LLM.
- **Flawless Warning Attachment:** Flight crew hazards are never stranded in separate chunks.

---

## 5. Configuration Options & Schema

The chunker exposes a flexible configuration schema (`DEFAULT_CHUNK_CONFIG`):

```typescript
interface ChunkConfig {
  strategy?: 'fixed_size' | 'heading_aware' | 'procedure_aware'; // Default: 'procedure_aware'
  maxChunkSize?: number;              // Max size in unit (default: 400)
  minChunkSize?: number;              // Min size to avoid tiny fragments (default: 50)
  overlap?: number;                   // Overlap size for sliding transitions (default: 40)
  unit?: 'tokens' | 'characters' | 'words'; // Measurement unit (default: 'tokens')
  preserveHeadings?: boolean;         // Track and include heading hierarchy (default: true)
  preserveProcedures?: boolean;       // Keep numbered checklists atomic (default: true)
  includeHeadingBreadcrumbs?: boolean;// Prepend "[Parent > Section]" breadcrumbs (default: true)
}
```

### Chunk Record DTO

```typescript
interface DocumentChunk {
  id: string;                         // Unique ID: "chunk_0", "chunk_1"
  text: string;                       // Cleaned chunk text including breadcrumbs
  chunkIndex: number;                 // Sequential 0-based chunk index
  startChar: number;                  // Character start offset in source document
  endChar: number;                    // Character end offset in source document
  tokenCount: number;                 // Estimated token count
  charCount: number;                  // Character count
  wordCount: number;                  // Word count
  metadata: {
    strategy: string;                 // Chunking strategy applied
    headings: string[];               // Ancestor headings stack: ["QRH", "Emergency Descent"]
    sectionTitle: string | null;      // Immediate section heading
    containsProcedure: boolean;       // True if chunk contains numbered steps
    containsWarning: boolean;         // True if chunk contains WARNING/CAUTION
    procedureSteps?: string[];        // Array of step identifiers found in chunk
    warnings?: string[];              // Array of warnings found in chunk
    isSplitProcedure?: boolean;       // True if an oversized procedure was sliced
  };
}
```

---

## 6. Usage Examples

### 6.1 Default Procedure-Aware Chunking
```javascript
import { chunkText } from './src/rag/chunker.js';

const chunks = chunkText(procedureManualText);

for (const chunk of chunks) {
  console.log(`Chunk #${chunk.chunkIndex} (${chunk.tokenCount} tokens):`);
  console.log(`Headings: ${chunk.metadata.headings.join(' > ')}`);
  console.log(`Contains Procedure: ${chunk.metadata.containsProcedure}`);
  console.log(chunk.text);
}
```

### 6.2 Custom Sizing and Units
```javascript
const chunks = chunkText(text, {
  strategy: 'heading_aware',
  maxChunkSize: 300,
  unit: 'tokens',
  includeHeadingBreadcrumbs: true
});
```

### 6.3 DocumentChunker Class with Custom Metadata
```javascript
import { DocumentChunker } from './src/rag/chunker.js';

const chunker = new DocumentChunker({
  maxChunkSize: 350,
  strategy: 'procedure_aware'
});

const chunks = chunker.chunk(documentText, {
  documentId: 'SOP-OPS-737-04',
  fleet: 'B737-800'
});
```

### 6.4 Running Comparative Benchmarks
```bash
node backend/scripts/compare_chunking_strategies.js
```
