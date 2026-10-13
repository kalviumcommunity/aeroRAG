# Structured Output & JSON Response Handling Guide

This guide details how **AeroRAG** guarantees structured, machine-readable JSON outputs from Large Language Models (LLMs), handles malformed outputs gracefully without crashing, and validates required fields for downstream enterprise airline systems.

---

## 1. Why Structured Output is Essential for App Integration

In production systems, an LLM assistant does not merely output text for a human reader; its response feeds directly into automated pipelines:
- **Database Persistence:** Query histories, compliance logs, and flight deviation records require relational columns or strict document fields (e.g. `answer`, `source.documentId`, `confidence`).
- **UI Components:** Frontend apps render structured elements like citation badges, authoritative document chips, effective dates, and confidence meters.
- **Safety Automation:** Airline operational software cannot parse free-form prose to verify whether a procedure has been superseded or approved.
- **Brittle Regex Failures:** Trying to parse arbitrary English text with regular expressions breaks whenever the model alters its sentence phrasing or synonyms.

---

## 2. How the Model Was Instructed to Produce Valid JSON

To ensure the model returns strictly structured data, AeroRAG employs a two-tier approach:

### Tier 1: Strict JSON Schema & System Prompt Instructions
The model is provided with an explicit schema and strict formatting rules:
\`\`\`text
You are AeroRAG, an airline procedure verification assistant.
You must respond ONLY with a valid JSON object matching this exact schema:
{
  "answer": "Direct verified operational instruction based only on retrieved documents",
  "source": {
    "documentId": "ID of authoritative document",
    "title": "Title of document",
    "status": "APPROVED",
    "effectiveDate": "YYYY-MM-DD"
  },
  "confidence": 0.95,
  "supersededNotes": "Notes about superseded documents or null",
  "isGrounded": true
}
Rules:
1. Return ONLY the raw JSON object. Do NOT wrap in markdown backticks (\`\`\`json).
2. Never invent procedures, regulations, dates, or operational instructions.
\`\`\`

### Tier 2: Native Model Response-Format / JSON Mode
Where supported by the API (e.g., Google Gemini's `responseMimeType: "application/json"` or OpenAI's `response_format: {"type": "json_object"}`), the model engine forces constrained token generation to guarantee valid JSON grammar at the decoding level.

---

## 3. How Parsing and Validation Works

The AeroRAG backend implements a multi-stage parser and validator in [`backend/src/rag/structuredOutput.js`](../backend/src/rag/structuredOutput.js):

\`\`\`
Raw LLM Text
     │
     ▼
[Stage 1: Direct JSON.parse] ──Success──► [Validation]
     │ (Fails)
     ▼
[Stage 2: Strip Markdown Fences] ──Success──► [Validation]
     │ (Fails)
     ▼
[Stage 3: Extract from Preamble/Postscript] ──Success──► [Validation]
     │ (Fails)
     ▼
[Stage 4: Syntax Repair (Commas, Quotes)] ──Success──► [Validation]
     │ (Fails)
     ▼
[Stage 5: Heuristic Regex Field Recovery] ──Success──► [Validation]
     │ (Fails)
     ▼
[Stage 6: Graceful Failure Report] (Never crash!)
\`\`\`

### Field Validation & Recovery
The validator checks:
1. **`answer` (Required):** Must be a non-empty string. If missing, attempts recovery from alternative keys (`response`, `directAnswer`).
2. **`source` (Required):** Must be an object with `documentId` or a string identifier. If passed as an array (`sources`), automatically migrates the first item. If passed as a plain string, normalizes it into a full source object.
3. **Optional Fields:** Defaults `confidence` to 0.9, `isGrounded` to true, and `supersededNotes` to null if omitted.

---

## 4. What Can Go Wrong with Model-Generated JSON?

Even advanced models can produce problematic JSON:
1. **Markdown Code Blocks:** Models frequently wrap responses in \`\`\`json ... \`\`\`, which causes standard `JSON.parse()` to throw a syntax error.
2. **Conversational Preamble/Postscript:** Models add pleasantries (*"Sure! Here is the JSON you requested..."*).
3. **Syntax Imperfections:** Trailing commas before closing brackets (`{ "a": 1, }`), unquoted keys, or single quotes instead of double quotes.
4. **Token Truncation:** If `max_tokens` is reached before the JSON closes, the stream cuts off mid-object, leaving unclosed brackets.
5. **Schema Drift:** The model invents unexpected key names (`doc_ref` instead of `source`).

---

## 5. Follow-Up Answer: How Would You Recover from Malformed Output?

When asked: *"How would you recover from malformed output?"*, present this 4-step recovery strategy:

1. **Step 1 — Progressive In-Code Sanitization:**
   Strip markdown backticks using regex, extract the substring between the outermost `{` and `}`, and fix common syntax defects like trailing commas (`,\s*}` $\to$ `}`).
2. **Step 2 — Heuristic Pattern Extraction:**
   If the JSON was cut off due to token limits, use targeted regex extraction to salvage critical fields (`answer`, `documentId`) so the user still receives useful information rather than a blank screen.
3. **Step 3 — Field Normalization & Safe Defaults:**
   If non-critical fields are missing or passed as alternative types (e.g. array instead of single object), normalize them automatically in the validation layer with recorded warnings.
4. **Step 4 — Automated Retry / Self-Correction Prompt:**
   If the output is completely corrupted (e.g. non-JSON text), trigger an automated retry with the previous error message sent back to the model (*"Your previous response was malformed with syntax error X. Please fix and return valid JSON only."*).

---

## 6. Video Walkthrough Script (3–5 Minutes)

Use this outline when recording your screen share walkthrough:

| Time | Segment | What to Cover |
|---|---|---|
| **0:00 - 0:45** | **Introduction & Why Structured Output is Needed** | State your name and project (AeroRAG). Explain why structured JSON is essential for apps (database logging, UI badges, safety automation) and why plain text is risky. |
| **0:45 - 1:30** | **Instruction & Schema Design** | Show `STRUCTURED_RAG_SCHEMA` and `STRUCTURED_SYSTEM_PROMPT` in `backend/src/rag/structuredOutput.js`. Mention native JSON mode (`responseMimeType: "application/json"`). |
| **1:30 - 2:30** | **Parsing & Malformed Recovery Demo** | Walk through the multi-stage parser in `backend/src/rag/structuredOutput.js`. Show the results table in `docs/structured_output_results.md` highlighting how markdown fences (3A), preambles (3B), trailing commas (3C), and truncated JSON (3D) are recovered. |
| **2:30 - 3:15** | **Field Validation** | Show `validateStructuredOutput()` verifying required fields (`answer` and `source`), how string sources are normalized, and how missing answers are rejected cleanly without crashing. |
| **3:15 - 4:00** | **Follow-up & Conclusion** | Answer the follow-up question: *"How to recover from malformed output?"* (Sanitization, syntax repair, heuristic regex recovery, field normalization, and LLM retry with error feedback). |
