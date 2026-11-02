# Milestones 3.16 & 3.17: Model Output Control & Structured Response Handling Guide

This document details the configuration of model parameters, provider incompatibility handling, the typed procedure response schema, and the resilient multi-stage JSON parsing and validation pipeline for **AeroRAG** (Day 8).

---

## 1. Executive Summary & Objectives

In airline flight procedure verification, generation must be strictly controlled, verifiable, and structured:
1. **Model Parameter Governance:** Ensures deterministic, low-temperature generation while explicitly handling provider-specific parameter constraints (such as parameters not supported by Google Gemini).
2. **Typed Operational Schema:** Enforces a strongly-typed JSON structure containing the verified answer, evidence references, applicability status, uncertainty score/level, and explicit refusal reasons.
3. **Resilient Multi-Stage Parsing:** Automatically recovers from markdown code fences, conversational preambles, trailing commas, and truncated token streams without throwing unhandled exceptions.
4. **Anti-Fabrication Invariant:** **Never fabricates evidence citations.** When evidence is absent, citations remain empty and an explicit refusal reason is recorded rather than inventing fictitious document IDs.
5. **Safe Enum Normalization:** Gracefully normalizes non-standard or synonym enum values (e.g. `CURRENT` $\rightarrow$ `APPLICABLE`, `DEPRECATED` $\rightarrow$ `SUPERSEDED`, or invalid values $\rightarrow$ `UNKNOWN`) without crashing.

---

## 2. Configurable Model Parameters (Milestone 3.16)

AeroRAG enforces grounded defaults across all model invocations:

```javascript
export const DEFAULT_GROUNDED_PARAMETERS = {
  temperature: 0.1,        // Deterministic, grounded generation
  maxOutputTokens: 500,    // Protects token budget & prevents runaway output
  topP: 0.8,               // Focuses on high-probability procedure tokens
  topK: 40,                // Narrows vocabulary candidates
  stopSequences: []        // Delimiter sequences to halt generation
};
```

### Provider Capabilities Matrix & Incompatibility Handling

Different LLM providers support different generation parameters. For instance, parameters common in OpenAI (e.g., `presencePenalty`, `frequencyPenalty`, `logitBias`) are unsupported by the Google Gemini API.

| Parameter | Gemini Support | OpenAI Support | Mock Adapter | Grounded Default | Notes |
|---|---|---|---|---|---|
| `temperature` | Supported | Supported | Supported | `0.1` | Clamped to `[0.0, 2.0]` |
| `maxOutputTokens` | Supported | `max_tokens` (aliased) | Supported | `500` | Clamped to `[1, 8192]` |
| `topP` | Supported | `top_p` (aliased) | Supported | `0.8` | Clamped to `[0.0, 1.0]` |
| `topK` | Supported | Unsupported | Supported | `40` | Integer `[1, 100]` |
| `stopSequences` | Supported | `stop` (aliased) | Supported | `[]` | Max 5 string sequences |
| `responseMimeType` | Supported (`application/json`) | `response_format` (aliased) | Supported | `application/json` | Enforces JSON output mode |
| `presencePenalty` | **Unsupported** | Supported | Supported | `0.0` | Explicitly handled / stripped |
| `frequencyPenalty` | **Unsupported** | Supported | Supported | `0.0` | Explicitly handled / stripped |
| `logitBias` | **Unsupported** | Supported | Supported | `null` | Explicitly handled / stripped |

### How Unsupported Parameters Are Handled
Through `validateModelParameters(params, provider, options)`:
- **Permissive Mode (Default):** Unsupported parameters are explicitly detected, excluded from the provider call to prevent API errors, and flagged with actionable diagnostic warnings in `metadata.unsupportedParameters`.
- **Strict Mode (`strict: true`):** Throws `UnsupportedParameterError` detailing the offending parameter, target provider, and list of supported alternatives.
- **Out-of-Bounds Values:** Safely clamped to provider bounds (e.g. `temperature: 3.5` $\rightarrow$ `2.0`) with logged warnings.

---

## 3. Typed Response Schema (Milestone 3.17)

Every procedure verification query returns a structured object adhering to `STRUCTURED_RAG_SCHEMA`:

```json
{
  "answer": "The sterile cockpit rule is strictly enforced during all critical phases below 10,000 feet MSL.",
  "evidenceReferences": [
    {
      "documentId": "SOP-OPS-737-04",
      "title": "Boeing 737 Sterile Cockpit and Critical Phase Procedures",
      "section": "1. Sterile Cockpit Environment",
      "page": 1,
      "effectiveDate": "2024-03-01",
      "status": "APPROVED",
      "quote": "The sterile cockpit rule is strictly enforced during all critical phases below 10,000 feet MSL."
    }
  ],
  "applicabilityStatus": "APPLICABLE",
  "uncertainty": {
    "level": "LOW",
    "score": 0.05,
    "reason": "Direct statement in current approved SOP"
  },
  "refusalReason": null
}
```

### Response Schema Field Definitions

| Field | Type | Description |
|---|---|---|
| `answer` | `string` | Direct verified operational instruction or standard refusal statement. |
| `evidenceReferences` | `array<object>` | List of flight manual evidence records (`documentId`, `title`, `section`, `page`, `effectiveDate`, `status`, `quote`). |
| `applicabilityStatus` | `string` | Enum: `APPLICABLE`, `SUPERSEDED`, `HISTORICAL`, `CONDITIONAL`, `NOT_APPLICABLE`, `UNKNOWN`. |
| `uncertainty` | `object` | Contains `level` (`LOW`, `MEDIUM`, `HIGH`, `COMPLETE`), `score` (`0.0 - 1.0`), and optional explanation `reason`. |
| `refusalReason` | `string \| null` | Set to `INSUFFICIENT_EVIDENCE`, `SAFETY_RESTRICTION`, `UNSUPPORTED_PROCEDURE`, `OUT_OF_DOMAIN`, or `null`. |
| `source` | `object` | Primary evidence reference (legacy compatibility). |
| `confidence` | `number` | Derived confidence score ($1.0 - \text{uncertainty.score}$). |
| `isGrounded` | `boolean` | `true` if grounded in verified evidence, `false` upon refusal. |

---

## 4. Multi-Stage Resilient Parser Pipeline

The parser in `processLlmOutput(rawText)` attempts recovery across six successive stages:

```
[Raw Model Response]
        |
        v
[Stage 1: Direct JSON.parse] -----------> (Success? -> Return)
        | (fails)
        v
[Stage 2: Markdown Code Fence Stripping]
- Strips ```json ... ``` or ``` ... ``` -> (Success? -> Return)
        | (fails)
        v
[Stage 3: Bracket Extraction]
- Extracts substring from first '{' to last '}' -> (Success? -> Return)
        | (fails)
        v
[Stage 4: Syntax Repair]
- Removes trailing commas: /,\s*([}\]])/ -> $1
- Quotes unquoted keys: /([{,]\s*)([a-zA-Z0-9_]+)\s*:/ -> $1"$2":
- Normalizes single-quoted string values -> (Success? -> Return)
        | (fails)
        v
[Stage 5: Heuristic Regex Field Recovery]
- Rescues fields from truncated token streams (answer, docId, status) -> (Success? -> Return)
        | (fails)
        v
[Stage 6: Non-Crashing Failure Reporting]
- Returns { success: false, valid: false, stage: 'PARSE_FAILED', errors: [...] }
```

---

## 5. Enum Normalization & Anti-Fabrication Rules

### Safe Enum Normalization
Model outputs often return colloquial or synonym terms. `normalizeApplicabilityStatus()` and `normalizeUncertainty()` resolve them safely:
- `CURRENT` / `ACTIVE` / `VALID` / `APPROVED` $\rightarrow$ `APPLICABLE`
- `DEPRECATED` / `OBSOLETE` / `OUTDATED` $\rightarrow$ `SUPERSEDED`
- `LEGACY` / `ARCHIVED` $\rightarrow$ `HISTORICAL`
- `REFUSED` / `INSUFFICIENT` $\rightarrow$ `NOT_APPLICABLE`
- Unknown / unparseable terms $\rightarrow$ `UNKNOWN` (with warning, never crashing)

### Anti-Fabrication Guarantee
If the model issues an answer without citing evidence, or when evidence is missing:
- **Evidence references remain strictly empty (`evidenceReferences: []`).**
- **The system NEVER fabricates fake document IDs, titles, or dates.**
- `isGrounded` is automatically set to `false`.

---

## 6. Testing & Verification

Run the complete test suite:
```bash
npm --prefix backend test
```
Or run the structured output test suite specifically:
```bash
node --test backend/tests/structuredOutput.test.js
```

**Test Coverage Highlights (`backend/tests/structuredOutput.test.js`):**
- Grounded default parameters and alias resolution (`max_tokens`, `stop`).
- Out-of-bounds parameter clamping and strict validation error assertions.
- Explicit detection of provider-unsupported parameters (`presencePenalty`, `frequencyPenalty`, `logitBias`).
- Successful parsing of complete typed schema payloads.
- Multi-stage recovery from markdown fences, conversational preambles, trailing commas, and truncated streams.
- Missing field recovery and rejection of unrecoverable payloads.
- Anti-fabrication assertions confirming zero fake citations are generated.
- Enum normalization without crashes.
- Mock adapter provider incompatibility simulation.
