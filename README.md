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

### Running Parameter Experiments

To execute the parameter experiment suite and refresh the comparison report:

```bash
node backend/scripts/run_parameter_experiments.js
```

Or via npm:

```bash
cd backend
npm run experiment:params
```
