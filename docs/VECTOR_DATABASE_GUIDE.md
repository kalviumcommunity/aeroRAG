# Vector Database Setup & Collection Design Guide

This guide details the vector database architecture, collection design, dimensional integrity rules, and production deployment considerations for **AeroRAG** (Concept 3.30).

---

## 1. What a Vector Database Does Differently from a Normal Database

| Characteristic | Traditional Database (SQL / MongoDB) | Vector Database (Chroma / Qdrant / Pinecone) |
|---|---|---|
| **Primary Query Type** | Exact match, range lookups, equality checks (\`WHERE doc_id = '737'\`) | Approximate Nearest Neighbor (ANN) search in multi-dimensional space |
| **Data Representation** | Scalar types (strings, integers, booleans, dates) | High-dimensional dense float vectors (embeddings) + metadata payloads |
| **Indexing Structures** | B-Trees, Hash indexes, GiST/GIN | Hierarchical Navigable Small World (HNSW) graphs, Inverted File (IVF), Product Quantization (PQ) |
| **Search Semantic** | Lexical / Keyword matching (exact wording) | Semantic similarity (captures meaning even with completely different phrasing) |
| **Mathematical Metric** | Boolean logic & relational algebra | Cosine similarity ($\cos \theta$), Euclidean distance ($L_2$), or Dot product ($\mathbf{A} \cdot \mathbf{B}$) |

---

## 2. Why the Collection Dimension Must Match the Embedding Model

Every embedding model projects text into a vector space with a fixed dimensionality:
- **Google \`text-embedding-004\`:** 768 dimensions
- **OpenAI \`text-embedding-3-small\` / \`ada-002\`:** 1536 dimensions
- **Nomic Embed Text v1.5:** 768 dimensions

### The Mathematical Rule:
Cosine similarity measures the cosine of the angle between two vectors:
$$\text{Similarity}(\mathbf{A}, \mathbf{B}) = \frac{\sum_{i=1}^{D} A_i B_i}{\sqrt{\sum_{i=1}^{D} A_i^2} \sqrt{\sum_{i=1}^{D} B_i^2}}$$

- **Dimensional Parity is Mandatory:** If vector $\mathbf{A}$ has $D = 768$ and vector $\mathbf{B}$ has $D = 1536$, the dot product $\mathbf{A} \cdot \mathbf{B}$ is mathematically undefined.
- **Fail-Early Design:** If a collection does not enforce dimension at creation time, mismatched vectors would either cause silent vector truncation, corrupted distance calculations, or runtime crashes during retrieval. In AeroRAG, attempting to insert mismatched vectors fails immediately with:
  \`"Dimension mismatch: Collection '768' requires 768-dimensional vectors, but received 1536"\`

---

## 3. AeroRAG Stored Record Schema

The schema in \`backend/src/rag/collectionManager.js\` is designed to store the vector, the source text, and rich domain metadata together:

\`\`\`json
{
  "id": "SOP-OPS-737-04:0",
  "vector": [0.0384, -0.0192, 0.0521, "... 768 float values total ..."],
  "text": "1. Sterile Cockpit Environment: The sterile cockpit rule is strictly enforced during all critical phases of flight below 10,000 feet MSL...",
  "metadata": {
    "source": "SOP-OPS-737-04",
    "document_title": "Boeing 737 Sterile Cockpit Procedures",
    "document_type": "Operational Manual",
    "status": "APPROVED",
    "effective_date": "2024-03-01",
    "chunk_index": 0,
    "section": "1. Sterile Cockpit Environment",
    "page": 1
  }
}
\`\`\`

---

## 4. Why Text and Metadata Are Stored With the Vector

1. **Eliminates Secondary Lookups (Low Latency):** If a vector database only returned raw vector IDs, the application would need to query a secondary database (like MongoDB or Postgres) to fetch the actual text for every retrieved chunk. Storing the raw text directly in the vector payload returns the full context in a single round-trip.
2. **Context for LLM Groundedness:** Nearest-neighbor search operates in mathematical space, but LLMs generate answers from natural language text. The text must be immediately available to construct the RAG prompt.
3. **Citations & Regulatory Auditability:** In aviation operations, an answer must cite the authoritative manual ID, effective date, and section number.
4. **Metadata Filtering:** Allows queries to filter by operational constraints (e.g. \`WHERE status == 'APPROVED' AND document_type == 'Operational Manual'\`) before performing similarity search.

---

## 5. Follow-Up Answer: How Would You Choose a Vector Database for Production?

When asked: *"How would you choose a vector database for production?"*, structure your answer around these 4 criteria:

1. **Scale & Dataset Size:**
   - **< 1M vectors:** Embedded or lightweight databases like **ChromaDB** or **pgvector** (if PostgreSQL is already in your stack) minimize infrastructure complexity and operational overhead.
   - **10M+ to Billions of vectors:** Purpose-built distributed engines like **Qdrant**, **Milvus**, or **Pinecone** provide horizontal partitioning and distributed sharding.
2. **Hosting Model & Regulatory Compliance:**
   - In airline flight operations with strict data sovereignty and security regulations (FAA/EASA/ITAR), a self-hosted vector database deployed inside your private cloud/VPC (such as **Qdrant** or **Chroma**) is often required over public third-party SaaS.
3. **Filtered Search Performance:**
   - If queries require complex metadata filters alongside vector search (e.g. filtering by aircraft type, supersession status, and effective dates), look for databases that support **single-stage payload filtering** (like Qdrant) rather than two-stage pre/post-filtering.
4. **Operational Cost vs. Managed Convenience:**
   - **Managed SaaS (Pinecone):** Zero maintenance, automated scaling, higher monthly cost.
   - **Self-Hosted (Qdrant / Chroma / pgvector):** Predictable compute/RAM costs, complete data control, requires team ops familiarity.

---

## 6. Video Walkthrough Script (3–5 Minutes)

| Time | Segment | What to Show & Say on Screen |
|---|---|---|
| **0:00 - 0:45** | **Introduction & Vector vs. Normal Database** | Introduce yourself and AeroRAG. Explain that normal databases do exact lookups ($A=B$), while vector databases perform Approximate Nearest Neighbor (ANN) search on embeddings to find semantic meaning. |
| **0:45 - 1:30** | **Dimension Matching** | Open \`backend/src/config/env.js\` and \`backend/src/rag/collectionManager.js\`. Explain why collection dimension (768) must match Google's \`text-embedding-004\`. Show that cosine similarity math is undefined if dimensions differ. |
| **1:30 - 2:30** | **Collection Schema & Storage Strategy** | Highlight the schema: \`id\`, \`vector\`, \`text\`, \`metadata\`. Explain why text and metadata belong with the vector (avoids multi-hop database lookups, provides context for LLMs, enables citations). |
| **2:30 - 3:30** | **Live Terminal Execution & Readback Demo** | Run \`node backend/scripts/run_vectordb_setup.js\` (or \`python backend/scripts/run_vectordb_setup.py\`). Show the terminal output: connection reachability, collection creation, test record insertion, and the readback showing matching ID, 768 vector length, text, and metadata. Show the dimension mismatch test being rejected! |
| **3:30 - 4:15** | **Follow-up Question & Conclusion** | Answer the follow-up question: *"How would you choose a vector database for production?"* (Cover Scale, Hosting/Compliance, Payload Filtering, and Cost vs Managed SLAs). |
