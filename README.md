# AeroRAG: Airline Procedure Verification Assistant

AeroRAG is an enterprise Retrieval-Augmented Generation (RAG) assistant designed for airline flight operations and procedure verification. It queries and verifies operational documentation, Standard Operating Procedures (SOPs), and supersession history to ensure flight crew compliance.

---

## 3.16 Model Parameters & Output Control

This branch (`feat/3.16-model-parameters-output-control`) implements model parameter controls, empirical experiments, and documented grounded settings for reliable, low-cost RAG generation.

### Key Highlights
- **Task 1 — Temperature Variation:** Demonstrates deterministic, repeatable, and hallucination-free output at low temperature ($T = 0.0 - 0.2$) versus high temperature ($T = 1.4$).
- **Task 2 — Max Tokens Length Capping:** Implements \`maxOutputTokens\` / \`max_tokens\` caps to guard against runaway generation and control API token costs.
- **Task 3 — Stop Sequences & Nucleus Sampling (\`top_p\`):** Tests stopping generation at defined delimiter sequences and compares nucleus sampling behavior.
- **Task 4 — Grounded Settings Documentation:** Detailed architectural guide in [`docs/GROUNDED_SETTINGS.md`](docs/GROUNDED_SETTINGS.md).
- **Task 5 — Experiment Outputs & Artifacts:** Complete comparisons in [`docs/parameter_experiments_output.md`](docs/parameter_experiments_output.md) and [`docs/parameter_experiments_output.json`](docs/parameter_experiments_output.json).

## 3.17 Structured Output & JSON Response Handling

This branch (`feat/3.17-structured-output-json-handling`) implements end-to-end structured JSON response handling, resilient parsing, malformed output recovery, and schema field validation.

### Key Highlights
- **Task 1 — JSON Schema & Response Formatting:** Instructs model via schema prompting and native `application/json` mode.
- **Task 2 — Usable Object Parsing:** Safely parses model outputs into strongly-typed objects consumed by backend and frontend.
- **Task 3 — Resilient Malformed JSON Recovery:** Recovers from markdown fences (````json````), conversational preambles/postscripts, trailing commas, unquoted keys, and truncated streams without throwing unhandled exceptions.
- **Task 4 — Required Field Validation:** Validates `answer` and `source` presence, normalizes alternative data types, and reports diagnostics.
- **Task 5 — Parsed Results Artifacts:** Documented test cases in [`docs/structured_output_results.md`](docs/structured_output_results.md) and [`docs/structured_output_results.json`](docs/structured_output_results.json).
- **Architecture & Video Guide:** Detailed guide in [`docs/STRUCTURED_OUTPUT_GUIDE.md`](docs/STRUCTURED_OUTPUT_GUIDE.md).

### Running Structured Output Experiments

To run the structured output test suite:

```bash
node backend/scripts/run_structured_output_experiments.js
```

Or via npm:

```bash
cd backend
npm run experiment:structured
```
