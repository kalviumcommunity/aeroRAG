# Grounded Model Parameters & Output Control Guide

This document outlines the recommended parameter settings for the **AeroRAG** airline procedure verification assistant (and factual RAG systems in general), along with the rationale and empirical findings from our parameter experiments.

---

## 1. Recommended Settings for Grounded RAG Tasks

| Parameter | Recommended Value | Primary Purpose | Impact on Safety & Quality |
|---|---|---|---|
| **\`temperature\`** | **\`0.0 - 0.2\`** | Deterministic & repeatable sampling | Eliminates creative drift, prevents hallucination of regulations/dates, forces faithful quotation of retrieved SOPs. |
| **\`max_tokens\`** (\`maxOutputTokens\`) | **\`300 - 500\`** | Output length & budget ceiling | Prevents runaway output, guarantees concise structured responses, strictly controls token billing costs. |
| **\`top_p\`** | **\`0.8 - 1.0\`** (or default) | Nucleus probability mass cutoff | Limits candidate tokens to high-likelihood vocabulary when temperature is slightly above 0. |
| **\`stop\`** (\`stopSequences\`) | **\`["\n\nUser:", "3. Supersession"]\`** (as needed) | Deterministic generation boundary | Halts generation immediately when a delimiter is reached; prevents prompt leakage and extraneous output. |

---

## 2. Parameter-by-Parameter Rationale

### A. Temperature (\`0.0 - 0.2\`) — Why Low Temperature Suits Grounded Answers
- **Mechanism:** In transformer models, temperature $T$ scales the logits before the softmax layer:
  $$\text{Softmax}(z_i / T)$$
  When $T \to 0$, the probability distribution becomes sharply peaked on the single most probable token (greedy decoding). When $T$ is high, the distribution flattens, giving lower-probability words a chance to be selected.
- **Why RAG Needs Low Temperature:**
  1. **Strict Context Adherence:** In airline flight operations, deviations from Standard Operating Procedures (SOPs) can compromise passenger safety. The model must report *only* the facts contained in the retrieved document chunks.
  2. **Repeatability:** If two pilots ask the same operational question, they must receive the identical factual guidance. At $T = 0.0$, repeated queries yield deterministic, identical answers.
  3. **Hallucination Prevention:** At higher temperatures ($T \ge 1.0$), models invent plausible-sounding details (e.g., attributing procedures to non-existent regulatory bodies or fabricating altitude thresholds). Low temperature prevents this variance.

### B. Max Tokens (\`max_tokens\` / \`maxOutputTokens\`) — Why Length Caps Matter for Cost & Safety
- **Mechanism:** Specifies the hard upper bound on output tokens the model may generate before execution terminates.
- **Why It Matters:**
  1. **Cost Control:** Large Language Model providers bill generation on output token volume (typically $3\times$ to $4\times$ more expensive than input tokens). Without \`max_tokens\`, a malfunctioning or repeating model can generate thousands of tokens per request, draining the operational budget.
  2. **Runaway Loop Protection:** Protects against repetitive loops or infinite generations.
  3. **Enforcing Conciseness:** Airline crew members during pre-flight or transit need immediate, actionable facts rather than long essays. Setting a sensible cap (e.g., 300–500 tokens) ensures the response remains concise and direct.

### C. Stop Sequences (\`stop\` / \`stopSequences\`) — Clean Boundaries
- **Mechanism:** A list of strings that tell the model to immediately stop emitting tokens when matched in the output stream.
- **Why It Matters:**
  1. **Preventing Prompt Leakage & Hallucinated Multi-Turn Chats:** In chat-based models, models may simulate user responses (e.g., starting a fake `User: ...` turn). Setting `stop: ["\n\nUser:"]` halts generation instantly.
  2. **Selective Section Retrieval:** If an interface only displays the direct procedure and authoritative document citation, passing `stop: ["\n3. Supersession"]` saves token generation and latency.

### D. Top_p (Nucleus Sampling) — Interaction with Temperature
- **Mechanism:** Limits candidate tokens to the smallest set whose cumulative probability reaches $p$.
- **Best Practice:** OpenAI and Google both recommend tuning *either* `temperature` or `top_p`, not both simultaneously. For grounded RAG, keeping `temperature = 0.1` and `top_p = 0.8` ensures high-confidence token selection.

---

## 3. AeroRAG Implementation

In \`backend/src/rag/llm.js\`, we established standard defaults:

\`\`\`javascript
export const GROUNDED_CONFIG = {
  temperature: 0.1,
  maxOutputTokens: 500,
  topP: 0.8,
  stopSequences: []
};

export const generateAnswer = async (query, contextChunks, customOptions = {}) => {
  const options = {
    ...GROUNDED_CONFIG,
    ...customOptions
  };
  // Passes options to Gemini generationConfig or mock generator
  ...
};
\`\`\`

---

## 4. Video Explanation Walkthrough Guide (3–5 Minutes)

For your video submission:
1. **Introduction (30s):** State your name and the topic: "3.16 Model Parameters & Output Control for AeroRAG". Explain that while prompts provide instruction, parameters control the generation behavior, cost, and factuality.
2. **Temperature & Grounded Answers (1m):**
   - Explain what temperature does (scales logits before softmax).
   - Why low temperature ($0.0 - 0.2$) is essential for RAG: eliminates hallucinations, ensures determinism, and keeps answers strictly grounded in retrieved airline SOPs.
   - Show the comparison table from \`docs/parameter_experiments_output.md\` ($T=0.0$ vs $T=1.4$).
3. **Max Tokens & Cost Control (1m):**
   - Explain what \`max_tokens\` controls.
   - Highlight why it matters for cost: output tokens are directly billed; caps prevent runaway generation and runaway bills.
   - Show the truncation test ($30$ tokens vs $100$ vs $400$ tokens).
4. **Additional Parameter Demo (1m):**
   - Demonstrate Stop Sequences (\`stopSequences\`) or \`top_p\`.
   - Show how the generation cleanly stops before unwanted sections or how nucleus sampling constrains vocabulary.
5. **Follow-Up Question & Conclusion (30s):**
   - *"Which settings would you use for a RAG answer and why?"*
   - Answer: `temperature = 0.1`, `max_tokens = 400`, `top_p = 0.8` (or default), plus contextual stop sequences. This combination guarantees 100% grounded, auditable answers while protecting the API budget.
