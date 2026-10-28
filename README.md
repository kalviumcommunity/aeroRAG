# AeroRAG: Airline Procedure Verification Assistant

AeroRAG is an enterprise Retrieval-Augmented Generation (RAG) assistant designed for airline flight operations and procedure verification. It queries and verifies operational documentation, Standard Operating Procedures (SOPs), and supersession history to ensure flight crew compliance.

---

## 3.12 LLM API Access & First Completion (Day 5)

This milestone (`feat/day-05-llm-client`) implements a minimal, tested LLM client adapter that sends messages to a configurable chat model, normalizes completions, and guarantees safe, non-crashing error handling.

### Key Highlights
- **Configurable LLM Client Adapter:** Unified abstraction supporting Google Gemini (`GeminiAdapter`) and local mock execution (`MockLLMAdapter`) via factory pattern (`createLLMClient`).
- **Environment-Driven Configuration:** Reads `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `LLM_MODEL` (default: `gemini-3.5-flash-lite`), `LLM_TIMEOUT_MS`, `LLM_TEMPERATURE`, `LLM_MAX_TOKENS`, and `LLM_TOP_P`.
- **Safe Error Handling Hierarchy:**
  - `MissingConfigurationError` (HTTP 400): Catches missing credentials with actionable resolution steps.
  - `LLMTimeoutError` (HTTP 504): Automatically aborts slow or hanging requests.
  - `RateLimitError` (HTTP 429): Handles quota exhaustion with retry-after diagnostics.
  - `InvalidResponseError` (HTTP 502): Detects empty candidate completions, content safety blocks, and malformed outputs.
  - `ProviderError` (HTTP 502/503): Classifies upstream network failures and 5xx outages.
- **Mock Implementation for Automated Tests:** High-fidelity `MockLLMAdapter` allows 100% test coverage without paid API calls, external dependencies, or network requirements.
- **Real API Smoke Test Runner:** `backend/scripts/smoke_test_llm.js` executes live verification calls against Google Gemini and reports results honestly to [`docs/llm_smoke_test_results.json`](docs/llm_smoke_test_results.json).
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/LLM_CLIENT_ADAPTER_GUIDE.md`](docs/LLM_CLIENT_ADAPTER_GUIDE.md).

---

## 3.13 & 3.18 Prompt Construction & Reusable Templates (Day 6)

This branch (`feat/day-06-prompt-templates`) implements maintainable, reusable prompt templates for the airline procedure assistant with strict role separation, safe template rendering, prompt injection defense, and procedure validity disambiguation.

### Key Highlights
- **Strict Role Separation:** Complete physical segregation between system safety instructions (`<system_instructions>`), untrusted retrieved evidence (`<retrieved_evidence>`), and operator queries (`<user_query>`).
- **The Four Procedure Validity States:**
  1. *Verified Current:* `APPROVED` / `ACTIVE` procedures treated as active operational authority for flight crews.
  2. *Historical Document:* `ARCHIVED` manuals identified as reference only, not active guidance.
  3. *Superseded Content:* `SUPERSEDED` SOPs explicitly identified with mandatory flight crew safety warnings not to follow obsolete standards.
  4. *Insufficient Evidence / Unsupported Questions:* Strict refusal mandate returning `"I could not find sufficient information in the available airline documents."` without speculating on flight parameters.
- **Conflict Resolution Precedence:** Deterministic priority rules: Status (`APPROVED` > `SUPERSEDED` > `ARCHIVED`) > Effective Date (Newer > Older) > Specificity (Aircraft SOP > General Fleet Policy).
- **Anti-Injection Firewall & Sanitization:** Neutralizes XML breakout tags (`</retrieved_evidence>`, `<user_query>`), strips control characters, detects injection signatures (`ignore previous instructions`, `system override`), and commands the model to treat retrieved evidence strictly as passive data.
- **Reusable Template Engine (`PromptTemplate`):** Explicit placeholder parsing (`{{var}}`), missing variable validation (`TemplateValidationError`), and safe string rendering.
- **Architecture Guide:** Comprehensive architectural guide in [`docs/PROMPT_TEMPLATES_GUIDE.md`](docs/PROMPT_TEMPLATES_GUIDE.md).

### Running Tests

**Run All Automated Tests:**
```bash
npm --prefix backend test
```
Or run the prompt template suite specifically:
```bash
node --test backend/tests/promptTemplates.test.js
```

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

## RAG Evaluation

The deterministic smoke evaluation runs the RAG pipeline against a small test set based on the checked-in vector-store fixture. It scores expected-fact correctness, evidence grounding, and source citation accuracy, including abstention questions. It forces offline `DEMO_MODE`, so results measure the demo generator and local fixture, not live Gemini quality.

From the repository root:
```bash
npm --prefix backend run evaluate:rag
```

The test cases are in [`backend/evaluation/rag_test_set.json`](backend/evaluation/rag_test_set.json). The runner writes per-case results to [`docs/rag_evaluation_results.json`](docs/rag_evaluation_results.json) and a scored summary to [`docs/rag_evaluation_results.md`](docs/rag_evaluation_results.md). The lexical scoring checks are reproducible smoke metrics, not a replacement for human evaluation.
