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

## 3.20 Text Extraction & Cleaning Pipeline (Day 10)

This milestone (`feat/day-10-text-cleaning`) implements a deterministic text-cleaning pipeline that normalizes whitespace and Unicode encoding, removes repetitive boilerplate safely, preserves headings, numbered steps, warnings, and tables, and computes extraction quality metrics.

### Key Highlights
- **Deterministic Encoding & Whitespace Normalization:**
  - Normalizes Unicode NFC composition, converts smart quotes (`“”`, `‘’`) and non-standard dashes (`—`, `–`, `−`) to ASCII equivalents.
  - Purges null bytes, Byte Order Marks (`\uFEFF`), zero-width spaces (`\u200B`), and converts non-breaking spaces (`\u00A0`) to standard spaces.
  - Normalizes CRLF/CR to Unix LF (`\n`), collapses redundant prose spaces, caps excessive empty lines to 2, and preserves table row column alignment.
- **Structural Integrity Preservation:**
  - *Procedure Numbering:* Accurately detects and preserves numbered and lettered checklist steps (`1.`, `2.`, `1.1`, `Step 1:`, `a.`, `(1)`, `1. **Bold**`).
  - *Headings & Boundaries:* Preserves Markdown headings (`#`, `##`, `###`) and uppercase aviation titles (`QUICK REFERENCE HANDBOOK`).
  - *Safety Warnings:* Preserves all callout blocks (`WARNING:`, `CAUTION:`, `NOTE:`, `DANGER:`, `MANDATORY:`) and boxed notices intact.
  - *Tables:* Preserves Markdown pipe tables and fixed-width columnar rows without mangling internal spacing.
- **Safety Invariant (Boilerplate Stripping Defense):**
  - **Never deletes text solely because it resembles a header or footer if doing so could remove an operational procedure or safety warning.**
  - Evaluates candidate lines against safety keywords, procedural verbs (`SET`, `VERIFY`, `CLOSE`), numbered steps, and flight parameter tokens (`ft`, `KIAS`, `FL`, `Vmo`).
  - Preserves protected candidate lines and logs informative `HEADER_PRESERVED_SAFETY` telemetry.
- **Extraction Quality Metrics & Telemetry:**
  - Tracks character, word, line, paragraph, heading, step, warning, and table counts.
  - Calculates reduction ratio and quality score (0 - 100) reflecting document readability, structural completeness, and clean layout.
- **Pluggable Architecture:** Reusable `TextCleaningPipeline` class with middleware registration (`.use(stepFn)`) integrated seamlessly with `documentLoader.js` and `textExtractor.js`.
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/TEXT_CLEANING_GUIDE.md`](docs/TEXT_CLEANING_GUIDE.md).

### Running Text Cleaning Tests

```bash
node --test backend/tests/textCleaner.test.js
```

---

## 3.21 Document Chunking Strategies (Day 11)

This milestone (`feat/day-11-document-chunking`) implements configurable, operational document chunking strategies including heading-aware and procedure-aware semantic chunking, enforcing strict safety invariants against severing procedural checklists or stranding safety warnings.

### Key Highlights
- **Configurable Operational Chunking Strategies:**
  - `FIXED_SIZE`: Token- and character-bounded sliding window with configurable overlap on word boundaries (baseline benchmark).
  - `HEADING_AWARE`: Hierarchical section-based chunking that tracks ancestor heading stacks and prepends contextual breadcrumbs (`[Parent > Child]`).
  - `PROCEDURE_AWARE` *(Chosen Default)*: Aviation-optimized chunking treating checklists as atomic units, binding warnings to their governed procedures, and partitioning oversized procedures strictly between discrete steps.
- **Safety Invariant (Procedure & Checklist Integrity):**
  - **Avoids splitting a numbered procedure in ways that destroy essential context.** Checklists (e.g. steps 1–6) are kept in a single chunk whenever feasible.
  - Guarantees that preceding `WARNING` and `CAUTION` blocks remain attached to the procedural steps they govern.
- **Comparative Strategy Benchmark:**
  - Benchmarked across 3 representative synthetic documents (QRH emergency descent checklist, ETOPS-180 diversion policy, FCOM flap asymmetry).
  - Demonstrates that `procedure_aware` produces 0 severed procedures, achieves the lowest chunk size variance (std dev 31.8 tokens), and guarantees 100% warning-to-step association.
  - Detailed benchmark artifacts in [`docs/chunking_strategy_comparison.md`](docs/chunking_strategy_comparison.md) and [`docs/chunking_strategy_comparison.json`](docs/chunking_strategy_comparison.json).
- **Pluggable Chunking Interface:** Reusable `DocumentChunker` class and backward-compatible `chunkText(text, optionsOrMaxTokens, overlapTokens)` function.
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/CHUNKING_STRATEGY_GUIDE.md`](docs/CHUNKING_STRATEGY_GUIDE.md).

### Running Document Chunking Tests & Benchmarks

**Run Unit Tests:**
```bash
node --test backend/tests/chunker.test.js
```

**Run Strategy Benchmark Runner:**
```bash
node backend/scripts/compare_chunking_strategies.js
```

---

## 3.22 Chunk Metadata, Source Tracking & Document Versioning (Day 12)

This milestone (`feat/day-12-document-version-metadata`) implements standardized chunk metadata schemas, source tracking, airline-specific document versioning, and relationship resolution, enforcing explicit uncertainty visibility and anti-fabrication controls.

### Key Highlights
- **Authoritative Document Metadata Schema:**
  - Tracks `documentId`, `title`, `documentType` (`SOP`, `QRH`, `FCOM`, `FCTM`, `SAFETY_BULLETIN`, `REGULATORY_DIRECTIVE`, `POLICY`), `source`, `version`, `publicationDate`, `effectiveDate`, `expiryDate`, and `fleetApplicability`.
  - Normalizes date representations to ISO 8601 strings and validates document type classifications.
- **Explicit Applicability & Verification State Machine:**
  - *Applicability Status:* `APPLICABLE`, `SUPERSEDED`, `HISTORICAL`, `CONDITIONAL`, `EXPIRED`, `NOT_APPLICABLE`, `UNKNOWN`.
  - *Verification Status:* `VERIFIED_OFFICIAL`, `UNVERIFIED`, `CONFLICTING`, `PROVISIONAL`, `REVOKED`.
- **The Three Core Safety Invariants:**
  - **Rule 1 (Temporal Invariant):** A later publication date alone must **NOT** establish that a document supersedes another. General training manuals do not silently supersede aircraft-specific operating procedures. Unlinked overlapping documents are flagged as `CONFLICTING` with `TEMPORAL_SUPERSEDION_DISALLOWED`.
  - **Rule 2 (Uncertainty Invariant):** Missing or conflicting metadata must remain visible as explicit uncertainty codes (`MISSING_DOCUMENT_ID`, `MISSING_PUBLICATION_DATE`, `MISSING_EFFECTIVE_DATE`, `UNVERIFIED_AUTHORITY`, `DOCUMENT_EXPIRED`, `CONFLICTING_VERSION_METADATA`).
  - **Rule 3 (Anti-Fabrication Invariant):** Do **NOT** claim official validity (`VERIFIED_OFFICIAL`) without documented approval evidence (`approvalStatus` and `approvedBy`). Unverified drafts default to `UNVERIFIED`.
- **Metadata Propagation & Authoritative Citations:**
  - Propagates document identity, versioning, and verification attributes down to chunk records (`${documentId}_chunk_${chunkIndex}`).
  - Generates standardized human-readable citation strings (e.g. `SOP-OPS-737-04 (Rev 4), Section: "Altimeter Setting Procedures", p. 12, Eff: 2024-03-01 [APPLICABLE / VERIFIED_OFFICIAL]`).
- **Pluggable Integration:** Seamlessly integrated into `chunkText` and `DocumentChunker` via `propagateMetadataToChunks`.
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/DOCUMENT_VERSIONING_GUIDE.md`](docs/DOCUMENT_VERSIONING_GUIDE.md).

### Running Metadata & Versioning Tests

**Run Metadata Unit Tests:**
```bash
node --test backend/tests/metadataManager.test.js
```

**Run All Backend Tests (197 Passing Tests):**
```bash
npm --prefix backend test
```

---

## 3.23 & 3.24 Token-Aware Sizing, Overlap & Corpus Validation (Day 13)

This milestone (`feat/day-13-ingestion-validation`) implements token-aware chunk limits, bounded overlap runaway growth defense, idempotent rerun handling, and a comprehensive corpus ingestion validation report.

### Key Highlights
- **Token-Aware Chunk Sizing Limits:**
  - Enforces strict token ceilings on chunks (`maxChunkSize`, default 400 tokens) using verified token estimators.
  - Normalizes options via `normalizeChunkingOptions` and validates unit compatibility (`tokens`, `characters`, `words`).
- **Configurable Overlap & Runaway Growth Defense:**
  - Configurable `overlap` bounded strictly: 0 <= overlap <= floor(maxChunkSize / 2).
  - Guaranteed forward progress prevents runaway chunk growth, zero-step looping, and chunk snowballing across multi-paragraph or repetitive checklists.
- **Corpus Ingestion Validation Report (`IngestionValidationReport`):**
  - Aggregates metrics: `totalDocuments`, `processedDocuments`, `failedDocuments`, `duplicateInputs`, `chunksCreated`, `extractedPages`, `extractedSections`, `metadataErrors`, and `successRate`.
  - Captures per-document status (`SUCCESS`, `FAILED`, `DUPLICATE_SKIPPED`, `DUPLICATE_UPDATED`), pages, sections, chunks, and content hashes.
- **Partial Failure Resilience & Non-Silent Failure Reporting:**
  - Corrupted, missing, empty, or unsupported documents fail gracefully without halting the remaining corpus.
  - Failures are recorded honestly in `report.failures` with diagnostic stage (`FILE_LOAD`, `TEXT_EXTRACTION`, etc.) and exact error messages.
- **Duplicate Detection & Safe Idempotent Reruns:**
  - Detects duplicate inputs via SHA-256 content hashes and document identifiers.
  - Supports configurable `DUPLICATE_STRATEGY`: `SKIP` (safe idempotent reruns without duplicate chunk creation), `UPDATE` (content refresh), or `ERROR` (strict policy enforcement).
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/INGESTION_VALIDATION_GUIDE.md`](docs/INGESTION_VALIDATION_GUIDE.md).

### Running Ingestion Validation Tests

**Run Ingestion Validation Unit Tests:**
```bash
node --test backend/tests/ingestionValidator.test.js
```

**Run All Backend Tests (218 Passing Tests):**
```bash
npm --prefix backend test
```

---

## 3.25 & 3.26 Embedding Service & Vector Space Validation (Day 14)

This milestone (`feat/day-14-embedding-service`) implements a configurable embedding adapter layer converting operational queries and procedure chunks into dense normalized vectors, validating dimensional integrity, and strictly enforcing vector space compatibility.

### Key Highlights
- **Configurable Embedding Adapter Layer:**
  - `BaseEmbeddingAdapter`: Standardized base class defining `embedQuery`, `embedBatch`, and `embedChunks`.
  - `MockEmbeddingAdapter`: High-fidelity offline adapter generating deterministic pseudo-semantic embeddings via coordinate term hashing, enabling 100% test coverage without network or API keys.
  - `GeminiEmbeddingAdapter`: Connects to Google Gemini live embeddings (`gemini-embedding-001` / `text-embedding-004`) with configurable timeout abort controls and quota rate limit classification (`429`).
  - `createEmbeddingAdapter(options)`: Factory abstraction selecting mock vs cloud provider based on environment and options.
- **Safety Invariant (Vector Space Compatibility):**
  - **Never assume two embedding models share a compatible vector space.**
  - `cosineSimilarity(vecA, vecB, metaA, metaB)` strictly checks that both vectors originate from the same embedding model and have identical dimensions. Throws `IncompatibleVectorSpaceError` on mismatched models or dimensions to prevent corrupted similarity retrieval.
- **Strict Vector Validation & L2 Normalization:**
  - `validateEmbeddingVector(vector, expectedDimensions)` guarantees vector length matches expected dimensions and checks that all coordinates are finite numbers (rejects `NaN`, `Infinity`, `-Infinity`).
  - Automatically normalizes vectors to unit length (L2 norm = 1.0) for standard cosine similarity calculation.
- **Batching Support & Model Identity Metadata Lineage:**
  - Automatic batching (`embedBatch`) splits large chunk arrays into chunks of `batchSize` (default: 32).
  - Binds model identity (`embeddingModel`, `embeddingDimensions`, `embeddingProvider`, `embeddingGeneratedAt`) to chunk indexing metadata.
- **Synthetic Semantic Similarity Demonstration:**
  - Demonstrates that semantically related procedural queries produce high similarity (e.g. 0.8121 on emergency descent procedures) while cross-domain unrelated texts yield low similarity (e.g. 0.5180 on baggage allowance rules), providing a 0.2942 separation delta.
- **Live API Smoke Test Runner:**
  - `backend/scripts/smoke_test_embedding.js` executes live verification calls against Google Generative AI when credentials are configured and reports honestly to [`docs/embedding_smoke_test_results.json`](docs/embedding_smoke_test_results.json).
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/EMBEDDING_SERVICE_GUIDE.md`](docs/EMBEDDING_SERVICE_GUIDE.md).

### Running Embedding Tests & Smoke Test

**Run Embedding Unit Tests (24 Passing Tests):**
```bash
node --test backend/tests/embeddingAdapter.test.js
```

**Run Real Provider Smoke Test:**
```bash
node backend/scripts/smoke_test_embedding.js
```

**Run All Backend Tests (242 Passing Tests):**
```bash
npm --prefix backend test
```

---

## 3.28 Batch Embedding & Rate/Cost Management (Day 15)

This milestone (`feat/day-15-batch-embedding-resilience`) implements a resilient batch embedding orchestration subsystem with configurable batch sizes, rate-limit retries with full exponential backoff and jitter, non-retryable error classification, partial batch failure handling, idempotent caching via stable content/model hashing, and usage accounting with transparent cost tracking.

### Key Highlights
- **Configurable Batch Ingestion Orchestration:**
  - `BatchEmbeddingManager`: Batches incoming text chunks (`batchSize`, default: 32) to respect upstream API payload limits.
  - Inter-batch pacing delay (`batchDelayMs`, default: 0) to avoid bursting against fixed requests-per-minute (RPM) quotas.
  - Seamlessly integrated with document ingestion pipeline in `backend/src/rag/ingester.js`.
- **Transient vs Permanent Error Classification:**
  - **Transient Errors (Retryable):** Network drops (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`), HTTP 429 (rate limit / quota exceeded), and HTTP 5xx server errors (500, 502, 503, 504) are automatically retried with bounded backoff.
  - **Permanent Errors (Non-Retryable):** Authentication/authorization failures (`401`, `403`, `EmbeddingAuthenticationError`), dimensional mismatches (`IncompatibleVectorSpaceError`), invalid payloads (`400`), and semantic input validation failures abort immediately on attempt 0 without wasting retry budgets or time.
- **Bounded Exponential Backoff with Full Jitter:**
  - Exponential backoff ceiling formula: $t_{ceiling} = \min(t_{max}, t_{base} \times 2^{\text{attempt}})$.
  - **Full Jitter:** Sleep delay uniformly sampled: $U(0, t_{ceiling})$, decorrelating concurrent worker retries and eliminating synchronized "thundering herds".
  - Priority header awareness: Respects upstream `retry-after` header when available.
  - Configurable retry bounds (`maxRetries`: 3, `initialBackoffMs`: 500, `maxBackoffMs`: 8000). Throws `BatchEmbeddingExhaustedRetriesError` when retry threshold is exceeded.
- **Partial Batch Failure Strategies:**
  - `isolate_subbatch`: Safely isolates poison-pill chunks in mixed batches by recursively sub-batching down to individual single-item calls, embedding valid chunks while isolating invalid ones.
  - `fail_batch`: Strictly rejects the batch if any chunk fails.
  - `permissive`: Returns `null` for failed chunks while preserving valid embeddings for the rest.
- **Idempotent Caching via Content/Model Hash:**
  - Cache key computed with SHA-256: `hash(modelName:dimensions:text)`.
  - Ensures repeated ingestion runs incur zero duplicate API calls and zero additional financial cost.
  - Preserves vector space isolation: if model or dimension changes, cache automatically invalidates.
- **Usage Accounting & Transparent Cost Estimation:**
  - Tracks total batches, total texts embedded, cache hit/miss counts, retry counts, and input token counts.
  - Transparent labeling: flags `isEstimated: false` when provider reports actual usage (e.g. Gemini `totalTokens`), and `isEstimated: true` when estimated via heuristic tokenizer.
  - Cost tracking: Computes `costUsd` only when model pricing data is configured, otherwise reports `pricingAvailable: false` and `costUsd: null` without fabricating financial figures.
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/BATCH_EMBEDDING_GUIDE.md`](docs/BATCH_EMBEDDING_GUIDE.md).

### Running Batch Embedding Tests

**Run Batch Embedding Manager Unit Tests (27 Passing Tests):**
```bash
node --test backend/tests/batchEmbeddingManager.test.js
```

**Run All Backend Tests (269 Passing Tests):**
```bash
npm --prefix backend test
```

---

## 3.27 & 3.29 Similarity Metrics, Embedding Quality & Deterministic Ranking (Day 16)

This milestone (`feat/day-16-similarity-quality-tests`) implements cosine similarity with strict input validation, vector quality audits, deterministic candidate ranking, a synthetic procedural evaluation benchmark, and safety anomaly reporting.

### Key Highlights
- **Mathematical Cosine Similarity & Vector Quality Auditing:**
  - Evaluates dot product, Euclidean distance, and cosine similarity with numerical precision clamping in $[-1.0, 1.0]$.
  - Rigorous input validation: rejects empty vectors, non-arrays, and non-finite values (`NaN`, `Infinity`, `-Infinity`).
  - Zero-magnitude vector handling: returns `0.0` similarity safely by default or throws `ZeroVectorError` when disallowed.
  - Dimension checking: throws `VectorDimensionMismatchError` when vector lengths differ or don't match collection requirements.
- **Safety Invariant — Model & Vector Space Compatibility:**
  - **Never assume two embedding models share a compatible vector space.**
  - `computeCosineSimilarity` strictly validates vector metadata and throws `IncompatibleVectorSpaceError` on model or dimensional mismatch to prevent vector space contamination.
- **Deterministic Candidate Ranking:**
  - `rankBySimilarity`: Ranks candidates by similarity descending with deterministic tie-breaking (candidate ID / chunk index) to eliminate non-deterministic ordering across runs and JS engines.
  - Slices `topK` and applies configurable `minSimilarityThreshold`.
  - **Safety Invariant Enforcement:** Every ranking output attaches `safetyDisclaimer`: *"Semantic similarity scores measure lexical/embedding vector proximity only. Similarity alone DOES NOT establish operational validity, regulatory compliance, aircraft effectivity, or flight crew safety approval."*
- **Synthetic Procedural Evaluation Benchmark:**
  - Ground-truth evaluation dataset ([`backend/evaluation/similarity_evaluation_set.json`](backend/evaluation/similarity_evaluation_set.json)) evaluating flight crew procedures (Emergency Descent, Engine Failure, Sterile Cockpit, Go-Around, Contaminated Runway) against unrelated topics (IFE streaming, pet travel, lounge access, luggage compensation) and borderline distractors.
  - Verified benchmark results:
    - **Top-1 Accuracy:** 80.0%
    - **Mean Related Similarity:** 0.424293
    - **Mean Unrelated Similarity:** 0.039119
    - **Separation Margin:** +0.385174 (exceeds $\ge +0.200$ threshold)
- **Anomaly Detection & Investigation Reporting:**
  - Automatically reports `UNEXPECTED_RANKING_INVERSION`, `LOW_PROCEDURAL_SIMILARITY`, and `HIGH_DISTRACTOR_SIMILARITY`.
  - Highlights `SUPERSEDED_PROCEDURE_RANKED_FIRST` safety warning: when a superseded checklist chunk achieves high semantic proximity, flags an alert that similarity does not establish operational validity.
- **Architecture Guide:** Comprehensive architectural documentation in [`docs/SIMILARITY_QUALITY_GUIDE.md`](docs/SIMILARITY_QUALITY_GUIDE.md).

### Running Similarity & Ranking Tests

**Run Similarity & Quality Unit Tests (28 Passing Tests):**
```bash
node --test backend/tests/similarityQuality.test.js
```

**Run Benchmark Evaluation Runner:**
```bash
npm --prefix backend run evaluate:similarity
```

**Run All Backend Tests (297 Passing Tests):**
```bash
npm --prefix backend test
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
