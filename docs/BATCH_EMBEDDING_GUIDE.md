# Airline Procedure Intelligence: Batch Embedding, Rate Limiting & Cost Management Guide

## Milestone 3.28 — Batch Embedding and Rate/Cost Management

Batching dense embedding generation for airline procedure manuals and checklists reduces network round-trip overhead and ingestion latency. However, large-scale embedding ingestion introduces operational risks: upstream quota exhaustion (HTTP 429), network timeouts (HTTP 504), poison pill payloads, duplicate API expenses on repeated ingestion runs, and unprincipled retry storms.

This guide details the resilient batch embedding architecture, error classification, bounded retry algorithm with exponential backoff and jitter, idempotent caching via stable hashes, and usage accounting implemented in **Milestone 3.28**.

---

## 1. Safety Invariants & Architectural Rules

| Safety Invariant | Rule | Rationale |
| :--- | :--- | :--- |
| **Non-Retryable Invariant** | **Do NOT retry permanent validation or authentication failures indefinitely.** | Errors caused by invalid API keys (401/403), dimension mismatches, non-finite values (`NaN`, `Infinity`), or malformed inputs cannot be resolved by retrying. They must fail immediately on attempt 0 without delay. |
| **Rate Limit Backoff Invariant** | All transient errors must use exponential backoff with full jitter, prioritizing provider `retryAfterMs`. | Retrying without delay or jitter induces a thundering herd on provider APIs, compounding rate-limit exhaustion. |
| **Idempotent Ingestion Invariant** | Repeated ingestion runs on identical chunks and models must reuse stable cache hashes. | Ingesting the same flight manual twice must not duplicate vector generation costs or trigger redundant API calls. |
| **Usage Accounting Invariant** | Clearly label token counts as actual (from provider) or estimated (from local tokenizer). | If provider token usage metadata is unavailable, token counts must be explicitly flagged with `isEstimated: true`. If pricing is unconfigured, costs must return `pricingAvailable: false` and `costUsd: null`. |

---

## 2. Error Classification

Errors encountered during batch embedding are classified strictly into two categories:

```
                                  Embedding Error Caught
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
         [ Transient / Retryable ]                      [ Permanent / Non-Retryable ]
         • 429 Rate Limit Exceeded                      • 401 Unauthorized / Invalid API Key
         • 504 Request Timeout                          • 403 Forbidden Access
         • 503 / 502 Service Unavailable                • 400 Bad Request / Invalid Parameter
         • Network Connection Reset (ECONNRESET)        • Dimension Mismatch (e.g. 768 vs 512)
         • Socket Timeout (ETIMEDOUT)                   • Non-finite coordinates (NaN / Infinity)
                    │                                   • Empty / Whitespace Query Input
                    ▼                                               │
         Execute Exponential Backoff                                ▼
         with Jitter up to maxRetries                   Fail Immediately on Attempt 0
```

---

## 3. Bounded Retries with Exponential Backoff and Full Jitter

When a transient error (such as a 429 rate limit or 504 timeout) occurs:

1. **Provider Priority:** If the provider response specifies a `Retry-After` header or duration (`retryAfterMs`), that exact delay is respected.
2. **Exponential Scaling:**
   $$\text{rawBackoff} = \min\left(\text{maxBackoffMs}, \text{initialBackoffMs} \times \text{backoffMultiplier}^{\text{attempt}}\right)$$
3. **Full Jitter:**
   $$\text{delayMs} = \text{round}\left(\text{random}(0, 1) \times \text{rawBackoff}\right)$$
   Full jitter decorrelates concurrent worker threads and prevents synchronized retry spikes.
4. **Retry Ceiling:** Retries are strictly bounded by `maxRetries` (default: 3). If all retries are exhausted, `BatchEmbeddingExhaustedRetriesError` is thrown with diagnostic history.

---

## 4. Partial Batch Failure Modes

When an individual item or sub-batch encounters an unrecoverable failure:

| Mode | Behavior | Use Case |
| :--- | :--- | :--- |
| **`fail_batch`** *(Default)* | Aborts the failed batch, records failure diagnostics, and raises `BatchEmbeddingExhaustedRetriesError`. Preserves previously completed batches. | Strict compliance environments where missing a single procedure step invalidates the batch. |
| **`isolate_subbatch`** | Automatically breaks the failing batch down into individual single-item requests to isolate the poison pill, salvaging all valid procedure chunks. | Resilient production intake where a single corrupt chunk should not halt 500 valid pages. |
| **`permissive`** | Records failed chunks with `embedding: null` in `failures` array, while returning all successful embeddings. | Diagnostic audit runs and non-blocking background indexing. |

---

## 5. Stable Content & Model Hashing (Idempotent Ingestion)

To avoid duplicate work on repeated ingestion runs, the system computes a SHA-256 cache key:

$$\text{cacheKey} = \text{SHA-256}\left(\text{modelName} : \text{dimensions} : \text{normalizedText}\right)$$

- When embedding a batch of $N$ chunks:
  1. Texts already present in the cache are served immediately as `cacheHits` without calling the provider.
  2. Only `cacheMisses` are dispatched in batch API requests.
  3. All $N$ embeddings are reassembled in the exact original order.
- Changing the model (e.g. `mock-v1` to `mock-v2` or `gemini-embedding-001`) automatically changes the cache key, preventing cross-model vector collisions.

---

## 6. Usage Accounting (Actual vs Estimated)

Every batch execution produces a structured usage telemetry block:

```javascript
{
  summary: {
    totalTexts: 20,
    successCount: 20,
    failureCount: 0,
    cacheHits: 8,            // 8 items served from cache
    cacheMisses: 12,          // 12 items embedded via provider API
    retriesAttempted: 1,      // 1 transient retry recovered
    durationMs: 342
  },
  usage: {
    totalTokens: 1450,
    isEstimated: true,        // Explicitly labeled if derived via tokenizer
    pricingAvailable: true,   // True if model pricing is configured
    costUsd: 0.000036         // Exact calculated cost: (1,450 / 1M) * $0.025
  },
  failures: []
}
```

---

## 7. Usage Example

```javascript
import { createBatchEmbeddingManager, MockEmbeddingAdapter } from './src/rag/batchEmbeddingManager.js';

const manager = createBatchEmbeddingManager({
  adapter: new MockEmbeddingAdapter({ model: 'text-embedding-004' }),
  batchSize: 10,
  maxRetries: 3,
  initialBackoffMs: 250,
  partialFailureMode: 'isolate_subbatch',
  pricing: { inputCostPerM: 0.025 }
});

const chunks = [
  { id: 'chunk_1', text: 'Sterile cockpit procedure below 10,000 ft...' },
  { id: 'chunk_2', text: 'Engine fire during takeoff checklist...' }
];

const result = await manager.embedChunks(chunks);

console.log(`Success: ${result.summary.successCount}/${result.summary.totalTexts}`);
console.log(`Tokens: ${result.usage.totalTokens} (Estimated: ${result.usage.isEstimated})`);
console.log(`Cost: $${result.usage.costUsd}`);
```
