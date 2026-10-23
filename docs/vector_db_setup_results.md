# Vector Database Setup & Collection Design Report

**Project:** AeroRAG Airline Procedure Verification Assistant  
**Concept:** 3.30 Vector Database Setup & Collection Design  
**Target Embedding Model:** Google `text-embedding-004` (768-dimensional)  
**Vector Database Mode:** LOCAL-PERSISTENT  

---

## 1. Vector Database Setup & Reachability (Task 1)

The vector database environment was initialized and confirmed reachable from application runtime.

| Parameter | Configured Value | Verified Runtime State |
|---|---|---|
| **Configured URL / Path** | `http://localhost:8000` | `C:\Users\ishu6\OneDrive\Desktop\aero\aeroRAG\data\vector_db` |
| **Reachability Status** | Reachable | **CONNECTED (ONLINE)** |
| **Operating Engine Mode** | Chroma / Local Persistent | `local-persistent` |
| **Ping Latency** | Benchmark | `2 ms` |

---

## 2. Collection Configuration & Vector Dimension (Task 2)

Embedding models require exact dimension parity. Vectors of dimension 768 cannot be compared against dimension 1536 without severe geometric distortion or matrix dimension errors.

```javascript
const VECTOR_DIMENSION = 768; // text-embedding-004
const COLLECTION_NAME = "aerorag_chunks";

const collection = await createCollection({
  name: COLLECTION_NAME,
  dimension: VECTOR_DIMENSION,
  metric: "cosine"
});
```

- **Collection Name:** `aerorag_chunks`
- **Vector Dimension:** `768` (Strictly enforced)
- **Distance Metric:** `cosine` (Cosine similarity)
- **Collection Metadata:**
```json
{
  "hnsw:space": "cosine",
  "dimension": 768,
  "description": "AeroRAG airline procedure verification chunks"
}
```

---

## 3. Stored Record Schema Design (Task 3)

The schema stores the dense vector embedding alongside the original plain-text chunk and rich domain metadata:

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Stable unique chunk identifier, e.g. 'doc-id:chunk_0'"
    },
    "vector": {
      "type": "array",
      "items": "number",
      "description": "Dense embedding vector of length matching dimension"
    },
    "text": {
      "type": "string",
      "description": "Original plain text of the document chunk"
    },
    "metadata": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string",
          "description": "Source document filename or identifier"
        },
        "document_title": {
          "type": "string",
          "description": "Human-readable manual/bulletin title"
        },
        "document_type": {
          "type": "string",
          "description": "Classification e.g. Operational Manual, Safety Bulletin"
        },
        "status": {
          "type": "string",
          "description": "Lifecycle state e.g. APPROVED, SUPERSEDED"
        },
        "effective_date": {
          "type": "string",
          "description": "Effective regulatory date (YYYY-MM-DD)"
        },
        "chunk_index": {
          "type": "integer",
          "description": "Position of chunk within the document"
        },
        "section": {
          "type": "string",
          "description": "Section header or checklist category"
        },
        "page": {
          "type": "integer",
          "description": "Page number if applicable"
        }
      },
      "required": [
        "source",
        "chunk_index"
      ]
    }
  },
  "required": [
    "id",
    "vector",
    "text",
    "metadata"
  ]
}
```

### Why Text and Metadata Belong With the Vector:
1. **Grounded Answer Synthesis:** Nearest-neighbor search retrieves vector IDs, but the LLM requires the **original plain text** to synthesize a verified answer.
2. **Citation Traceability:** Downstream airline compliance requires citing the originating **documentId**, **status** (e.g. APPROVED vs. SUPERSEDED), and **effectiveDate**.
3. **Pre- and Post-Filtering:** Enables metadata-filtered retrieval (e.g. searching only chunks where `status == "APPROVED"`).

---

## 4. Insert and Readback Verification (Task 4)

A realistic Boeing 737 sterile cockpit procedure chunk was embedded, upserted, and read back:

### Readback Inspection
- **Readback ID:** `SOP-OPS-737-04:0`
- **Vector Length:** `768` (Exact match: `true`)
- **Original Source Text:**
> *"1. Sterile Cockpit Environment: The sterile cockpit rule is strictly enforced during all critical phases of flight below 10,000 feet MSL. Crew members shall not engage in non-essential conversations or tasks."*

### Stored Metadata Verification:
```json
{
  "source": "SOP-OPS-737-04",
  "document_title": "Boeing 737 Sterile Cockpit and Critical Phase Procedures",
  "document_type": "Operational Manual",
  "status": "APPROVED",
  "effective_date": "2024-03-01",
  "chunk_index": 0,
  "section": "1. Sterile Cockpit Environment",
  "page": 1
}
```

---

## 5. Dimension Enforcement & Integrity Test (Task 5)

Attempting to insert a 1536-dimensional vector into the 768-dimensional collection triggers early validation failure:

- **Attempted Dimension:** 1536
- **Expected Dimension:** 768
- **Enforcement Result:** **REJECTED EARLY WITHOUT CORRUPTING INDEX**
- **Captured Error:** `Dimension mismatch: Collection '768' requires 768-dimensional vectors, but received 1536`

---

## 6. Summary Status
- **Reachable Database Setup:** Verified (100%)
- **Correct Vector Dimension:** 768
- **Schema Validation:** Vector + Source Text + Metadata Stored Together
- **Insert / Readback Test:** SUCCESS
