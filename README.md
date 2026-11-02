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

This milestone (`feat/day-06-prompt-templates`) implements maintainable, reusable prompt templates for the airline procedure assistant with strict role separation, safe template rendering, prompt injection defense, and procedure validity disambiguation.

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

---

## 3.14 & 3.15 Tokens, Cost Estimation & Context Management (Day 7)

This milestone (`feat/day-07-token-context-management`) implements token estimation utilities, pricing-governed cost estimation, context window budget allocation, and bounded conversation history management.

### Key Highlights
- **Token Estimation & Counting:** Employs model tokenizers when online (`countTokens()`) or aviation-calibrated heuristic estimation (~3.8 chars/token) when offline, explicitly flagging whether token counts are exact or approximate.
- **Configured Cost Calculation:** Computes prompt, completion, and total costs with 6-decimal precision **only** when verified pricing data is configured. Returns `pricingAvailable: false` and `totalCostUsd: null` for unconfigured models to prevent fabricated costs.
- **Context Budget Allocation (`ContextBudgetManager`):** Partitions total context capacity (`MAX_CONTEXT_TOKENS`, default 8,192 tokens) across inviolable system instructions, model response headroom (`maxOutputTokens`: 500), and retrieved evidence.
- **Safety Invariant (Evidence Protection):** **Never silently remove safety-critical evidence.** If retrieved airline procedures exceed available context headroom, the system throws an explicit `ContextBudgetExceededError` rather than silently omitting operational flight rules.
- **Bounded Conversation History:** Deterministically trims dialogue turns using FIFO (preserving newest interactions) and executes pluggable summarization hooks (`summarizeHook`) when history overflows. Guards against oversized messages (`OversizedMessageError`).
- **Architecture Guide:** Detailed architectural specification in [`docs/TOKEN_CONTEXT_MANAGEMENT_GUIDE.md`](docs/TOKEN_CONTEXT_MANAGEMENT_GUIDE.md).

---

## 3.16 & 3.17 Model Output Control & Structured Response Handling (Day 8)

This branch (`feat/day-08-structured-output`) implements configurable model parameters, provider incompatibility handling, a typed response schema, and a resilient multi-stage JSON parser and validator.

### Key Highlights
- **Configurable Model Parameters with Grounded Defaults:** Validates parameters (`temperature: 0.1`, `maxOutputTokens: 500`, `topP: 0.8`, `topK: 40`, `stopSequences: []`) and clamps out-of-bounds values safely.
- **Provider-Specific Incompatibility Handling:** Explicitly handles parameters unsupported by Google Gemini (e.g. `presencePenalty`, `frequencyPenalty`, `logitBias`), dropping them with warnings in permissive mode or throwing `UnsupportedParameterError` in strict mode to prevent provider API failures.
- **Typed Procedure Response Schema (`STRUCTURED_RAG_SCHEMA`):**
  - `answer`: Verified operational instruction text or explicit refusal statement.
  - `evidenceReferences`: Array of authoritative source records (`documentId`, `title`, `section`, `page`, `effectiveDate`, `status`, `quote`).
  - `applicabilityStatus`: Enum (`APPLICABLE`, `SUPERSEDED`, `HISTORICAL`, `CONDITIONAL`, `NOT_APPLICABLE`, `UNKNOWN`).
  - `uncertainty`: Object with `level` (`LOW`, `MEDIUM`, `HIGH`, `COMPLETE`), `score` (`0.0 - 1.0`), and `reason`.
  - `refusalReason`: Procedural refusal classification (`INSUFFICIENT_EVIDENCE`, `SAFETY_RESTRICTION`, `UNSUPPORTED_PROCEDURE`, `OUT_OF_DOMAIN`, or `null`).
- **Multi-Stage Resilient Parser:** Automatically recovers from markdown code fences, conversational preambles/postscripts, trailing commas, unquoted keys, single quotes, and truncated token streams.
- **Safe Enum Normalization & Anti-Fabrication:** Normalizes colloquial status synonyms without crashing, and guarantees that evidence citations are **never** fabricated on missing documentation or refusal.
- **Architecture Guide:** Detailed architectural specification in [`docs/MODEL_OUTPUT_CONTROL_GUIDE.md`](docs/MODEL_OUTPUT_CONTROL_GUIDE.md).

### Running Tests

**Run All Automated Tests:**
```bash
npm --prefix backend test
```
Or run the structured output and model parameters test suite specifically:
```bash
node --test backend/tests/structuredOutput.test.js
```

---

## 3.19 Document Loading & Multi-Format Intake (Day 9)

This milestone (`feat/day-09-document-loaders`) implements modular intake loaders for heterogeneous airline procedure formats (**PDF**, **DOCX**, **Plain Text**, and **Markdown**, with additional **HTML** support), enforcing untrusted input protections, host path sanitization, and automatic scanned PDF detection for OCR handoff.

### Key Highlights
- **Modular Loaders for Heterogeneous Formats:**
  - `PdfLoader`: Extracts multi-page text streams and page counts via embedded PDFJS engine.
  - `DocxLoader`: Extracts OpenXML text runs and paragraphs via Mammoth without macro execution.
  - `TextLoader`: Reads plain text files, normalizes newlines, and strips UTF-8 BOM headers.
  - `MarkdownLoader`: Extracts procedural text while capturing hierarchical section headings (`#`, `##`, `###`).
  - `HtmlLoader`: Strips `<script>`, `<style>`, and markup tags, outputting clean readable text.
- **Untrusted Input Security Model:**
  - *Server Path Redaction:* Host filesystem paths (e.g. `C:\Users\...` or `/home/...`) are strictly redacted in document outputs and error messages; only safe virtual paths (`documents/<filename>`) are exposed.
  - *Execution Prevention:* Dangerous script blocks (`<script>`, `<iframe>`, `<object>`, `<embed>`), inline event handlers (`onload=`, `onerror=`), and `javascript:` pseudoprotocols are completely stripped.
  - *Directory Traversal Defense:* Filenames are sanitized against directory traversal attacks (`../`, null bytes, control characters).
- **Scanned PDF Identification (OCR Required):**
  - Detects non-text or scanned image PDFs where extractable text is absent or below character threshold (`charCount < 35`).
  - Flags `isScanned: true`, `requiresOcr: true`, and assigns `status: 'REQUIRES_OCR'` with diagnostic reasoning rather than silently treating the file as complete.
- **Validation, Size Limits & Error Resilience:**
  - Enforces configurable maximum file size (default: 25 MB) with `DocumentSizeExceededError`.
  - Rejects empty documents (0 bytes or whitespace only) with `EmptyDocumentError`.
  - Dispatches `UnsupportedFormatError` detailing attempted format and complete list of supported formats.
  - Recovers from corrupted archives and damaged PDFs with `CorruptedDocumentError`.
  - `loadCorpus(dirPath)` scans mixed-format directories, segregating loaded, OCR-required, and skipped files without crashing the batch.
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/DOCUMENT_LOADING_GUIDE.md`](docs/DOCUMENT_LOADING_GUIDE.md).

### Running Document Loader Tests

```bash
node --test backend/tests/documentLoader.test.js
```

---

## 3.30 Vector Database Setup & Collection Design

This milestone (`feat/3.30-vector-db-setup-collection-design`) implements vector store setup, dimensional integrity enforcement, and collection schema design storing dense embedding vectors, source text, and rich metadata.

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
