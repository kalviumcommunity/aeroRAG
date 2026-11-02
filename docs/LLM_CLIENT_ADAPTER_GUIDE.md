# Milestone 3.12: LLM API Access & First Completion Guide

This document specifies the architecture, error handling taxonomy, configuration parameters, mock implementation, and live provider smoke testing for the **AeroRAG LLM Client Adapter** (Milestone 3.12 — Day 5).

---

## 1. Overview & Objectives

In airline flight operations and procedure verification, LLM generation must be reliable, resilient, and fault-tolerant. Unhandled API failures, hangs, rate limit exhaustion, or malformed responses can cause system-wide disruption.

The **LLM Client Adapter** provides a clean, provider-agnostic abstraction that:
1. Sends structured chat messages to a configurable LLM model.
2. Normalizes model responses into a standardized telemetry-enriched schema.
3. Enforces safe, non-crashing error handling across 5 distinct failure categories:
   - **Missing Configuration:** Missing API credentials or model settings.
   - **Timeouts:** Latency spikes safely aborted via timers and `Promise.race`.
   - **Rate Limits:** Provider quotas (HTTP 429 / `RESOURCE_EXHAUSTED`) converted into retryable errors with backoff hints.
   - **Invalid Responses:** Empty candidates, content safety blocks, or non-text outputs handled cleanly.
   - **Provider Errors:** Upstream 5xx service failures and network interruptions classified with root-cause diagnostics.
4. Provides a zero-cost, high-fidelity **MockLLMAdapter** for automated test suites.
5. Implements a real API smoke test runner (`scripts/smoke_test_llm.js`) with honest reporting.

---

## 2. Adapter Architecture

```
+-----------------------------------------------------------------------------------+
|                                 Consumer Layers                                   |
|   (RAG Pipeline / RAG Controller / CLI Runners / Unit & Integration Tests)        |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                         createLLMClient(options) Factory                          |
+-----------------------------------------------------------------------------------+
                                          |
                     +--------------------+--------------------+
                     |                                         |
                     v                                         v
   +------------------------------------+    +------------------------------------+
   |           GeminiAdapter            |    |           MockLLMAdapter           |
   |------------------------------------|    |------------------------------------|
   | - @google/generative-ai SDK        |    | - Zero-cost local execution        |
   | - Configurable model name          |    | - Canned responses / resolvers     |
   | - Active timeout abort race        |    | - Simulates: Timeout, 429, 503,    |
   | - Error categorization & safety    |    |   invalid responses, missing auth  |
   | - Token usage & latency telemetry  |    | - Full call telemetry & history    |
   +------------------------------------+    +------------------------------------+
                     |                                         |
                     +--------------------+--------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                            Normalized Response Object                             |
| { text, model, provider, usage, finishReason, latencyMs, metadata, raw }          |
+-----------------------------------------------------------------------------------+
```

---

## 3. Environment Variable Configuration

All credentials and runtime settings are loaded through `backend/src/config/env.js`.

| Variable | Type | Default | Description |
|---|---|---|---|
| `GOOGLE_API_KEY` | String | (empty) | Primary Google Generative AI API key. |
| `GEMINI_API_KEY` | String | (empty) | Alternative Google Gemini API key fallback. |
| `LLM_PROVIDER` | String | `gemini` | Active provider (`gemini` or `mock`). |
| `LLM_MODEL` | String | `gemini-3.5-flash-lite` | Configurable model identifier. |
| `LLM_TIMEOUT_MS` | Number | `30000` | Maximum wait duration before aborting requests. |
| `LLM_TEMPERATURE` | Number | `0.1` | Sampling temperature for grounded generation. |
| `LLM_MAX_TOKENS` | Number | `500` | Maximum token generation cap. |
| `LLM_TOP_P` | Number | `0.8` | Nucleus sampling probability cutoff. |
| `DEMO_MODE` | Boolean | `false` | When true or no API key is set, defaults to mock adapter. |

---

## 4. Safe Error Handling Matrix

The client defines an explicit error taxonomy extending `LLMClientError`:

| Error Class | Category | HTTP Status | Retryable | Trigger Condition |
|---|---|---|---|---|
| `MissingConfigurationError` | `MISSING_CONFIGURATION` | 400 | No | `GOOGLE_API_KEY` / `GEMINI_API_KEY` missing or invalid format. |
| `LLMTimeoutError` | `TIMEOUT` | 504 | Yes | Request exceeds `LLM_TIMEOUT_MS` threshold. |
| `RateLimitError` | `RATE_LIMIT` | 429 | Yes | Provider HTTP 429, `RESOURCE_EXHAUSTED`, or quota exceeded. |
| `InvalidResponseError` | `INVALID_RESPONSE` | 502 | No | Empty candidates, safety filter blocks (`finishReason === 'SAFETY'`), or empty prompts. |
| `ProviderError` | `PROVIDER_ERROR` | 502 / 503 | Yes | Upstream network failure, service outage, or 5xx response. |

---

## 5. Normalized Response Schema

Every completion returns a consistent schema regardless of provider:

```json
{
  "text": "The sterile cockpit rule prohibits flight crew members from engaging in non-essential activities during critical phases of flight, typically below 10,000 feet.",
  "model": "gemini-3.5-flash-lite",
  "provider": "gemini",
  "usage": {
    "promptTokens": 20,
    "completionTokens": 69,
    "totalTokens": 89
  },
  "finishReason": "STOP",
  "latencyMs": 1158,
  "metadata": {
    "temperature": 0.1,
    "maxOutputTokens": 250,
    "topP": 0.8,
    "stopSequences": []
  },
  "raw": { /* Underlying provider response */ }
}
```

---

## 6. How to Configure a Real Provider

To run real completions against Google Gemini:

### Step 1: Obtain a Gemini API Key
1. Visit [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** and generate a new key.

### Step 2: Configure Environment
Add the key to your `backend/.env` file:
```env
GOOGLE_API_KEY=AIzaSyYourSecretGeminiKeyHere
LLM_MODEL=gemini-3.5-flash-lite
LLM_TIMEOUT_MS=30000
```
Or export it directly in your terminal:
```bash
# PowerShell
$env:GOOGLE_API_KEY="AIzaSyYourSecretGeminiKeyHere"
$env:LLM_MODEL="gemini-3.5-flash-lite"

# Bash / Linux / macOS
export GOOGLE_API_KEY="AIzaSyYourSecretGeminiKeyHere"
export LLM_MODEL="gemini-3.5-flash-lite"
```

### Step 3: Run the Smoke Test
```bash
npm --prefix backend run test:smoke
```

---

## 7. Testing & Verification

### Automated Mock-Based Tests (Zero-Cost)
The automated test suite runs offline without consuming API tokens:
```bash
npm --prefix backend test
```
Or specifically:
```bash
npm --prefix backend run test:mock
```

**Test Coverage Highlights:**
- Normalization of prompts and chat message arrays.
- Canned text, dynamic function resolvers, and sequential response queues.
- Accurate stop sequences and max token truncation simulation.
- Simulation of all 5 error classes (`MissingConfigurationError`, `LLMTimeoutError`, `RateLimitError`, `InvalidResponseError`, `ProviderError`).
- Factory and singleton caching validation.

### Real API Smoke Test
```bash
npm --prefix backend run test:smoke
```
- When credentials are configured, sends a verification prompt to the live Gemini model, measures real network latency, and writes results to [`docs/llm_smoke_test_results.json`](./llm_smoke_test_results.json).
- When credentials are not set, reports honestly that the live test was skipped without faking success.
