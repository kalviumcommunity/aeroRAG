# AeroRAG: Airline Procedure Verification Assistant

AeroRAG is an enterprise Retrieval-Augmented Generation (RAG) assistant designed for airline flight operations and procedure verification. It queries and verifies operational documentation, Standard Operating Procedures (SOPs), and supersession history to ensure flight crew compliance.

---

## 3.16 Model Parameters & Output Control

This branch (`feat/3.16-model-parameters-output-control`) implements model parameter controls, empirical experiments, and documented grounded settings for reliable, low-cost RAG generation.

### Key Highlights
- **Task 1 — Temperature Variation:** Demonstrates deterministic, repeatable, and hallucination-free output at low temperature ($T = 0.0 - 0.2$) versus high temperature ($T = 1.4$).
- **Task 2 — Max Tokens Length Capping:** Implements `maxOutputTokens` / `max_tokens` caps to guard against runaway generation and control API token costs.
- **Task 3 — Stop Sequences & Nucleus Sampling (`top_p`):** Tests stopping generation at defined delimiter sequences and compares nucleus sampling behavior.
- **Task 4 — Grounded Settings Documentation:** Detailed architectural guide in [`docs/GROUNDED_SETTINGS.md`](docs/GROUNDED_SETTINGS.md).
- **Task 5 — Experiment Outputs & Artifacts:** Complete comparisons in [`docs/parameter_experiments_output.md`](docs/parameter_experiments_output.md) and [`docs/parameter_experiments_output.json`](docs/parameter_experiments_output.json).

---

## 3.17 Structured Output & JSON Response Handling

This branch (`feat/3.17-structured-output-json-handling`) implements end-to-end structured JSON response handling, resilient parsing, malformed output recovery, and schema field validation.

### Key Highlights
- **Task 1 — JSON Schema & Response Formatting:** Instructs model via schema prompting and native `application/json` mode.
- **Task 2 — Usable Object Parsing:** Safely parses model outputs into strongly-typed objects consumed by backend and frontend.
- **Task 3 — Resilient Malformed JSON Recovery:** Recovers from markdown fences (````json````), conversational preambles/postscripts, trailing commas, unquoted keys, and truncated streams without throwing unhandled exceptions.
- **Task 4 — Required Field Validation:** Validates `answer` and `source` presence, normalizes alternative data types, and reports diagnostics.
- **Task 5 — Parsed Results Artifacts:** Documented test cases in [`docs/structured_output_results.md`](docs/structured_output_results.md) and [`docs/structured_output_results.json`](docs/structured_output_results.json).
- **Architecture & Video Guide:** Detailed guide in [`docs/STRUCTURED_OUTPUT_GUIDE.md`](docs/STRUCTURED_OUTPUT_GUIDE.md).

---

## 3.30 Vector Database Setup & Collection Design

This branch (`feat/3.30-vector-db-setup-collection-design`) implements vector store setup, dimensional integrity enforcement, and collection schema design storing dense embedding vectors, source text, and rich metadata.

### Key Highlights
- **Task 1 — Vector Database Setup & Reachability:** Connects to vector database via local config and environment variables (`VECTOR_DB_URL`, `VECTOR_DIMENSION`, `COLLECTION_NAME`), verifying reachability and health status.
- **Task 2 — Correctly Sized Collection:** Creates collection `aerorag_chunks` configured with dimension 768 to match Google's `text-embedding-004` model with cosine similarity. Enforces dimensional parity to prevent index corruption.
- **Task 3 — Stored Record Schema:** Implements schema storing dense embedding vector + original source text + comprehensive metadata (`source`, `document_title`, `document_type`, `status`, `effective_date`, `chunk_index`, `section`, `page`).
- **Task 4 — Insert & Readback Test:** Inserts a Boeing 737 sterile cockpit procedure test chunk and reads it back, validating ID, vector length (768), text, and metadata integrity. Confirms semantic similarity search.
- **Task 5 — Documentation & Test Artifacts:** Complete test outputs in [`docs/vector_db_setup_results.md`](docs/vector_db_setup_results.md) and [`docs/vector_db_setup_results.json`](docs/vector_db_setup_results.json). Comprehensive architectural walkthrough in [`docs/VECTOR_DATABASE_GUIDE.md`](docs/VECTOR_DATABASE_GUIDE.md).

### Running Vector Database Setup & Readback Tests

**Node.js Runner:**
```bash
node backend/scripts/run_vectordb_setup.js
```
Or via npm:
```bash
cd backend
npm run vectordb:setup
```

**Python Runner:**
```bash
python backend/scripts/run_vectordb_setup.py
```
Or via npm:
```bash
cd backend
npm run vectordb:py
```
