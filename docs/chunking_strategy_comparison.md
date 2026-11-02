# Document Chunking Strategies Benchmark & Comparison

> **Milestone:** 3.21 — Document chunking strategies  
> **System:** AeroRAG Airline Procedure Intelligence  
> **Evaluation Date:** 2026-11-02T07:35:46.308Z  
> **Config:** `maxChunkSize = 250 tokens`, `overlap = 30 tokens`

---

## 1. Executive Summary & Recommended Default

For airline procedure intelligence, chunking operational flight manuals requires balancing semantic retrieval with **flight safety invariants**:
- **Baseline Fixed-Size Sliding Window:** Suffers from severe boundary hazards, frequently severing checklist sequences mid-step and stranding safety warnings away from their operational procedures.
- **Heading-Aware Chunking:** Effectively clusters text by section and captures hierarchical parent breadcrumbs, but risks splitting long multi-step procedures between sub-chunks if heading sections are broad.
- **Procedure-Aware Chunking (CHOSEN DEFAULT):** Treats checklists and procedures as atomic cohesive units, binds critical `WARNING` and `CAUTION` blocks directly to the procedures they govern, and guarantees that flight crews receive complete, unbroken operating sequences.

**Chosen Default Strategy:** `procedure_aware`  
**Operational Rationale:** Procedure-aware chunking maintains atomic checklist integrity, preserves critical warning-to-step associations, and ensures flight crews receive complete, unbroken operating instructions during RAG retrieval.

---

## 2. Comparative Benchmark Metrics

| Metric | Fixed-Size Window | Heading-Aware | Procedure-Aware (Default) |
| :--- | :--- | :--- | :--- |
| **Total Chunks Produced** | 6 | 14 | 7 |
| **Average Tokens / Chunk** | 210 | 106 | 191.3 |
| **Average Chars / Chunk** | 759.5 | 383.2 | 691.6 |
| **Size Std Deviation (Tokens)** | 56 | 52.5 | 31.8 |
| **Procedures Severed / Split** | High (Arbitrary) | Moderate | **0 (Zero Severed)** |
| **Warning Co-occurrence** | Poor (Often Isolated) | Fair | **Excellent (Bound to Steps)** |
| **Heading Context Preservation** | None (Raw Window) | Complete (Hierarchical) | **Complete (Hierarchical)** |

---

## 3. Detailed Document Chunk Previews


### QRH-EMER-01: Emergency Descent and Rapid Depressurization
- **Strategy:** `procedure_aware` | **Total Chunks:** 2

  - **`chunk_0`** (231 tokens) [Headings: *Quick Reference Handbook (QRH) - Emergency Descent*]
    - *Contains Procedure:* `true` | *Contains Warning:* `true`
    - *Sample:* `[Quick Reference Handbook (QRH) - Emergency Descent]  # Quick Reference Handbook`

  - **`chunk_1`** (149 tokens) [Headings: *Quick Reference Handbook (QRH) - Emergency Descent > Airspeed Strategy & Structural Integrity*]
    - *Contains Procedure:* `true` | *Contains Warning:* `false`
    - *Sample:* `[Quick Reference Handbook (QRH) - Emergency Descent > Airspeed Strategy & Struct`



### SOP-ETOPS-180: Extended Twin-Engine Diversion Requirements
- **Strategy:** `procedure_aware` | **Total Chunks:** 3

  - **`chunk_0`** (192 tokens) [Headings: *Standard Operating Procedure: ETOPS-180 Operational Requirements*]
    - *Contains Procedure:* `false` | *Contains Warning:* `false`
    - *Sample:* `[Standard Operating Procedure: ETOPS-180 Operational Requirements]  # Standard O`

  - **`chunk_1`** (148 tokens) [Headings: *Standard Operating Procedure: ETOPS-180 Operational Requirements > 1. Dispatch Suitability and Weather Minimums*]
    - *Contains Procedure:* `true` | *Contains Warning:* `false`
    - *Sample:* `[Standard Operating Procedure: ETOPS-180 Operational Requirements > 1. Dispatch `

  - **`chunk_2`** (207 tokens) [Headings: *Standard Operating Procedure: ETOPS-180 Operational Requirements > 2. Fuel Planning Scenarios*]
    - *Contains Procedure:* `false` | *Contains Warning:* `true`
    - *Sample:* `[Standard Operating Procedure: ETOPS-180 Operational Requirements > 2. Fuel Plan`



### FCOM-ABN-27: Flap / Slat Asymmetry and Jammed Control Surfaces
- **Strategy:** `procedure_aware` | **Total Chunks:** 2

  - **`chunk_0`** (230 tokens) [Headings: *Flight Crew Operations Manual: Flap & Slat Asymmetry*]
    - *Contains Procedure:* `true` | *Contains Warning:* `true`
    - *Sample:* `[Flight Crew Operations Manual: Flap & Slat Asymmetry]  # Flight Crew Operations`

  - **`chunk_1`** (182 tokens) [Headings: *Flight Crew Operations Manual: Flap & Slat Asymmetry > Flap Extension Speed Limits Matrix*]
    - *Contains Procedure:* `true` | *Contains Warning:* `false`
    - *Sample:* `[Flight Crew Operations Manual: Flap & Slat Asymmetry > Flap Extension Speed Lim`



---

## 4. Key Architectural Findings

1. **Procedure Integrity is Flight-Critical:** Splitting a 6-step emergency descent checklist between two chunks means an LLM query might retrieve steps 1-3 without steps 4-6, leading to incomplete flight crew guidance.
2. **Warning Placement Invariant:** When a `WARNING` precedes a checklist, the procedure-aware chunker bundles the warning directly with the checklist, preventing hallucinated or missing hazard context.
3. **Heading Breadcrumb Injection:** Prepending `[QRH > Emergency Descent]` to chunk text ensures dense vector embeddings encode the flight phase even if the section body lacks explicit phase keywords.
