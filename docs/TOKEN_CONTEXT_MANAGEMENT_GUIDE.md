# Milestones 3.14 & 3.15: Tokens, Cost Estimation & Context Budget Management Guide

This document details the tokenization architecture, cost estimation model, context window budget allocation, and bounded conversation history management for **AeroRAG** (Milestones 3.14 & 3.15 — Day 7).

---

## 1. Executive Summary & Operational Goals

In an enterprise airline procedure assistant, context window exhaustion, unmonitored API expenditures, or silent omission of operational manuals can introduce severe flight safety risks.

Milestones 3.14 & 3.15 establish rigorous control over token economics and context allocation:
1. **Token Estimation:** Estimates token counts using the configured model's tokenizer when online or calibrated heuristic algorithms when offline.
2. **Cost Calculation:** Computes financial costs **only** when verified pricing data is configured. Never invents or fabricates pricing figures.
3. **Context Budget Allocation:** Partitions the model's finite context window into strictly enforced reservations for system safety directives, model response headroom, and operational evidence.
4. **Safety Invariant (Non-Negotiable):** **Never silently remove safety-critical evidence.** If evidence exceeds capacity, the system throws an explicit error rather than silently omitting operational flight rules.
5. **Bounded Conversation History:** Employs deterministic FIFO truncation and pluggable summarization hooks to maintain multi-turn dialogue within remaining context headroom.

---

## 2. Token Counting & Estimation Architecture

### Model Tokenizer vs. Heuristic Estimation
AeroRAG implements a multi-tier token counting approach:

```
+-----------------------------------------------------------------------------------+
|                            estimateTokenCount(input, options)                     |
+-----------------------------------------------------------------------------------+
                                          |
                +-------------------------+-------------------------+
                |                                                   |
       [Tokenizer Available?]                               [Tokenizer Offline?]
                |                                                   |
                v                                                   v
+-------------------------------+                   +-------------------------------+
|   Model Native Tokenizer      |                   | Domain Heuristic Estimator    |
| (modelInstance.countTokens)   |                   | (Character-to-token ratio     |
| - Exact token count           |                   |  ~3.8 chars/tok + punctuation)|
| - isExact: true               |                   | - Approximate token count     |
| - method: 'model_tokenizer'   |                   | - isExact: false              |
+-------------------------------+                   | - method: 'heuristic_est...'  |
                                                    +-------------------------------+
```

### When Token Counts Are Approximate
> [!IMPORTANT]
> Token counts are flagged as **approximate** (`isExact: false`) whenever:
> - The live model tokenizer is offline, rate-limited, or unavailable (e.g. running unit tests, mock adapter, or disconnected environments).
> - Token counts are calculated synchronously using `estimateTokenCountSync()`.
> 
> In heuristic mode, token counts are estimated using an aviation-calibrated English ratio of **~3.8 characters per token** plus non-word/symbol overhead. When exact counts are returned via the Google Generative AI SDK, `isExact` is set to `true`.

---

## 3. Cost Calculation Framework

### The Safe Pricing Rule
Cost calculation is executed **only when verified pricing data is configured**. If a model is unrecognized and no custom overrides are configured, the system reports `pricingAvailable: false` and `totalCostUsd: null` rather than fabricating arbitrary figures.

### Built-in Pricing Table (USD per 1M Tokens)

| Model Name | Prompt Rate / 1M | Completion Rate / 1M | Pricing Status |
|---|---|---|---|
| `gemini-1.5-flash` | \$0.075 | \$0.30 | Exact Configured |
| `gemini-1.5-pro` | \$1.25 | \$5.00 | Exact Configured |
| `gemini-2.5-flash` | \$0.075 | \$0.30 | Exact Configured |
| `gemini-2.5-flash-lite` | \$0.075 | \$0.30 | Exact Configured |
| `gemini-3.5-flash-lite` | \$0.075 | \$0.30 | Exact Configured |
| `gemini-3.8-flash` | \$0.10 | \$0.40 | Exact Configured |
| `mock` | \$0.00 | \$0.00 | Free / Zero-Cost |
| *Unrecognized Models* | *Unconfigured* | *Unconfigured* | `pricingAvailable: false` |

### When Costs Are Approximate
> [!NOTE]
> Costs are calculated as:
> $$\text{Total Cost} = \left(\frac{\text{Prompt Tokens}}{1,000,000} \times \text{Input Rate}\right) + \left(\frac{\text{Completion Tokens}}{1,000,000} \times \text{Output Rate}\right)$$
> Costs are **approximate** when based on heuristic token estimations. When based on exact API `usageMetadata` token counts and verified published pricing, `isExactPricing` is set to `true`.

---

## 4. Context Budget Allocation & Evidence Protection

The `ContextBudgetManager` divides the model's total context capacity (`MAX_CONTEXT_TOKENS`, default 8,192 tokens) into four dedicated tiers:

```
+-----------------------------------------------------------------------------------+
| TOTAL CONTEXT WINDOW BUDGET (e.g., 8,192 Tokens)                                  |
|                                                                                   |
| [1. System Instructions]  Immutable safety & grounding directives (Inviolable)   |
| [2. Response Reserve]     Headroom for model completion (maxOutputTokens: 500)    |
| [3. User Query]           Active pilot / dispatcher question                      |
| [4. Retrieved Evidence]   Safety-critical airline SOP chunks & metadata           |
| [5. Dialogue History]     Remaining dynamically allocated headroom                |
+-----------------------------------------------------------------------------------+
```

### Safety Invariant: Evidence Must Never Be Silently Dropped
> [!CAUTION]
> **Safety Invariant:** In commercial flight operations, missing a single sentence (e.g., *"Do not extend flaps above 250 knots"*) can result in an emergency.
> 
> Therefore, **the system will NEVER silently truncate, cut, or omit retrieved safety-critical evidence** to fit within budget. If retrieved evidence exceeds the available context headroom, `ContextBudgetManager` immediately throws `ContextBudgetExceededError` with explicit diagnostic details.

---

## 5. Bounded Conversation History Management

When pilots engage in multi-turn troubleshooting conversations, older dialogue turns must be bounded so they do not exhaust the context window:

1. **Deterministic FIFO Trimming:**
   - Retains the most recent dialogue turns (Turn $N$, Turn $N-1$).
   - Discards the oldest non-system dialogue turns from the head of the array until total tokens satisfy `historyBudget`.
2. **Summarization Hook:**
   - When turns are dropped, callers can provide an optional `summarizeHook: async (droppedMessages) => string`.
   - The generated procedural summary is prepended to the retained history:
     `{ role: 'system', content: '[PRIOR CONVERSATION SUMMARY: ...]' }`.
   - If the summarization hook fails or throws, the manager falls back to clean FIFO truncation without crashing.
3. **Oversized Message Guard:**
   - Single messages exceeding permissible token thresholds throw `OversizedMessageError`, preventing prompt injection or memory exhaustion attacks.
4. **Empty History Handling:**
   - Empty, null, or undefined histories return `{ messages: [], trimmedCount: 0, totalTokens: 0, wasTruncated: false }`.

---

## 6. Test Suite & Verification ([`backend/tests/tokenContextManager.test.js`](../backend/tests/tokenContextManager.test.js))

The test suite covers:
- **Token Estimation:** Empty inputs, string texts, message arrays, synchronous estimators, model tokenizers.
- **Cost Calculation:** 6-decimal precision, zero-token handling, custom rate overrides, unconfigured model handling (`pricingAvailable: false`).
- **Context Budget Allocation:** Inviolable system overhead, response reserve, safety invariant evidence protection (`ContextBudgetExceededError`).
- **Bounded Conversation History:** FIFO trimming, summarization hooks, hook error resilience, empty history handling.
- **Oversized Messages:** Detecting and rejecting messages exceeding safety thresholds (`OversizedMessageError`).
- **Adapter Telemetry:** Confirming `MockLLMAdapter` and `GeminiAdapter` responses return enriched `usage` and `cost` objects.

```bash
npm --prefix backend test
# Result: 67 passed, 0 failed across all test suites
```
