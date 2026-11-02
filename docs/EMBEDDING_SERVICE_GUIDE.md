# Airline Procedure Intelligence: Embedding Service & Vector Space Validation Guide

## Milestones 3.25 & 3.26 — Embeddings & Generating Embeddings via API

Retrieval-Augmented Generation (RAG) in aviation operations relies heavily on dense vector representations. A query like *"How to initiate an emergency descent?"* must be mapped into the exact same latent semantic space as checklist passages from the Quick Reference Handbook (QRH).

This guide details the embedding adapter architecture, vector normalization, batch processing, vector space compatibility enforcement, and smoke testing implemented in **Milestones 3.25 & 3.26**.

---

## 1. Safety Invariants

| Safety Invariant | Rule | Rationale |
| :--- | :--- | :--- |
| **Vector Space Invariant** | **Never assume two embedding models share a compatible vector space.** | Vector coordinates from one model (e.g. `text-embedding-004` [768]) cannot be compared or queried against coordinates from another model (e.g. `gemini-embedding-001` [3072] or `text-embedding-3-small` [1536]). Doing so corrupts similarity rankings and distorts procedure retrieval. |
| **Numeric Finiteness Invariant** | All vector values must be finite floating-point numbers. | Reject `NaN`, `Infinity`, `-Infinity`, or non-numeric types immediately via `validateEmbeddingVector`. Corrupted coordinates cause similarity calculations to fail or yield false positives. |
| **Unit Normalization Invariant** | Vectors must be normalized to unit length ($L_2$ norm = 1.0). | Normalization allows cosine similarity to be computed efficiently via dot product: $\cos(\theta) = \mathbf{A} \cdot \mathbf{B}$. |

---

## 2. Adapter Architecture

The embedding layer mirrors the LLM Client architecture, providing a unified abstraction across local mock execution and live cloud providers.

```
                  ┌──────────────────────────────┐
                  │    createEmbeddingAdapter    │
                  └──────────────┬───────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
    ┌─────────────────────────┐     ┌─────────────────────────┐
    │   MockEmbeddingAdapter  │     │ GeminiEmbeddingAdapter  │
    │  (100% Offline / Tests) │     │ (Live Cloud Generation) │
    └─────────────────────────┘     └─────────────────────────┘
```

### Components
1. **`BaseEmbeddingAdapter`**: Abstract base defining `embedQuery(text)`, `embedBatch(texts, options)`, and `embedChunks(chunks, options)`.
2. **`MockEmbeddingAdapter`**: High-fidelity offline adapter generating deterministic pseudo-semantic embeddings via token frequency and n-gram coordinate projection. Operates 100% offline with zero external dependencies.
3. **`GeminiEmbeddingAdapter`**: Connects to Google Generative AI embeddings (`gemini-embedding-001` or `text-embedding-004`), enforcing timeout bounds (`AbortSignal`), rate limit classification (`429`), and response validation.
4. **`createEmbeddingAdapter(options)`**: Factory function creating the appropriate adapter based on environment variables and parameters.

---

## 3. Embedding Model Identity with Indexing Metadata

Every chunk embedded by the system binds the embedding model identity to its metadata record:

```javascript
{
  id: "SOP-737-04_chunk_0",
  text: "Sterile cockpit procedures apply below 10,000 feet MSL...",
  embedding: [0.0381, -0.0192, 0.0514, ...],
  metadata: {
    documentId: "SOP-737-04",
    sectionTitle: "Sterile Cockpit Procedures",
    page: 12,
    citation: "SOP-737-04 (Rev 4), Section: \"Sterile Cockpit Procedures\", p. 12 [APPLICABLE / VERIFIED_OFFICIAL]",
    // Embedding Model Identity Lineage
    embeddingModel: "gemini-embedding-001",
    embeddingDimensions: 3072,
    embeddingProvider: "gemini",
    embeddingGeneratedAt: "2026-11-02T08:24:40.072Z"
  }
}
```

---

## 4. Vector Space Compatibility Enforcement

The `cosineSimilarity(vecA, vecB, metaA, metaB)` function strictly validates vector space compatibility before calculating similarity:

```javascript
import { cosineSimilarity, IncompatibleVectorSpaceError } from './src/rag/embeddingAdapter.js';

const vecA = [...]; // Generated with "text-embedding-004"
const vecB = [...]; // Generated with "text-embedding-3-small"

try {
  const score = cosineSimilarity(vecA, vecB,
    { model: 'text-embedding-004', dimensions: 768 },
    { model: 'text-embedding-3-small', dimensions: 768 }
  );
} catch (err) {
  console.error(err instanceof IncompatibleVectorSpaceError); // true
  // Incompatible vector spaces: cannot compare or query vectors from different embedding models
}
```

---

## 5. Synthetic Semantic Similarity Demonstration

The offline test suite (`backend/tests/embeddingAdapter.test.js`) demonstrates that semantically related procedural questions produce high similarity, while unrelated domain text yields low similarity:

- **Query:** `"How do flight crews initiate an emergency descent procedure?"`
- **Related Procedure:** `"EMERGENCY DESCENT CHECKLIST 1. Announce emergency descent on PA. 2. Set passenger signs to ON. 3. Retard thrust levers to flight idle. 4. Extend speedbrakes smoothly..."`
- **Unrelated Text:** `"BAGGAGE ALLOWANCE AND FARE RULES Economy passengers are permitted one standard carry-on bag..."`

```
Related Procedure Similarity:   0.8121 (High semantic alignment)
Unrelated Baggage Similarity:   0.5180 (Low cross-domain alignment)
Separation Margin:              0.2942 (Substantial discriminatory power)
```

---

## 6. Live API Smoke Test Runner

When API credentials are configured, the real provider smoke test runner can be executed against Google Gemini:

```bash
node backend/scripts/smoke_test_embedding.js
```

Outputs are recorded honestly in [`docs/embedding_smoke_test_results.json`](embedding_smoke_test_results.json):

```json
{
  "status": "SUCCESS",
  "timestamp": "2026-11-02T08:24:40.072Z",
  "provider": "gemini",
  "model": "gemini-embedding-001",
  "dimensions": 3072,
  "sampleQuery": "How do pilots initiate an emergency descent?",
  "similarityResults": {
    "relatedSimilarity": 0.812127,
    "unrelatedSimilarity": 0.517964,
    "separationMargin": 0.2942
  },
  "testPassed": true
}
```
If credentials are not present, the test reports `SKIPPED` honestly without failing the build.
