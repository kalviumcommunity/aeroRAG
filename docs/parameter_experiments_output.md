# Model Parameters & Output Control: Experiment Results

**Project:** AeroRAG Airline Procedure Verification Assistant  
**Evaluated Parameters:** `temperature`, `max_tokens` (`maxOutputTokens`), `stopSequences` (`stop`), and `top_p`  

---

## Task 1 — Temperature Variation & Effects

The goal of this experiment is to demonstrate how changing the `temperature` parameter affects response stability, adherence to retrieved context, and creativity.

### Results Table

| Temperature | Run # | Consistency | Risk of Hallucination / Drift | Summary of Observation |
|---|---|---|---|---|
| **0.0** | Run 1 & Run 2 | **100% Identical / Deterministic** | **Minimal (0%)** | Strict adherence to source text; exact citations maintained. |
| **0.7** | Run 1 & Run 2 | **Moderate Variance** | **Low-Medium** | Subtle synonym variations (*"mandated protocol"* vs *"specified directive"*). |
| **1.4** | Run 1 & Run 2 | **High Divergence** | **High** | Introduces embellished wording (*"shout STERILE COCKPIT!"*, extraneous advisory bodies). |

### Example Outputs

#### 1. Temperature = 0.0 (Run 1 & Run 2)
```text
1. Direct answer:
Under approved SOP-OPS-737-04, the sterile cockpit rule applies below 10,000 feet MSL. If a deviation occurs:
- The observing crew member must immediately issue the standardized verbal challenge: "STERILE COCKPIT".
- The active crew member must immediately cease non-essential activity and respond: "STERILE COCKPIT COPIED".
- Any persistent or safety-compromising deviation must be logged in the Captain's Voyage Report after the flight.

2. Authoritative document:
SOP-OPS-737-04 (Boeing 737 Sterile Cockpit and Critical Phase Procedures, Effective Date: 2024-03-01, Status: APPROVED).

3. Supersession notes:
SOP-OPS-737-03 (effective 2021-06-15) recommended sterile cockpit below 8,000 feet, but is SUPERSEDED and must not be used for operational procedures.
```
*Verification:* Run 2 at temperature 0.0 returned the exact same structured answer word-for-word, demonstrating zero drift.

#### 2. Temperature = 0.7
```text
1. Direct answer:
According to the mandated protocol, during critical phases below 10,000 feet, the observing crew member must firmly announce "STERILE COCKPIT". The other crew member must immediately cease all extraneous discussions and acknowledge with "STERILE COCKPIT COPIED". Post-flight logging in the Captain's Voyage Report is required if safety is impacted.

2. Authoritative document:
Document SOP-OPS-737-04 is currently active and approved as of March 1, 2024.

3. Supersession notes:
Document SOP-OPS-737-03 is obsolete and superseded; its 8,000-foot guideline is invalid.
```

#### 3. Temperature = 1.4
```text
1. Direct answer:
Pilots encountering cockpit chatter or distractions below 10,000 ft flight levels must instantly shout "STERILE COCKPIT!" to restore undivided situational awareness. The responding pilot echoes "STERILE COCKPIT COPIED". A safety report should also ideally be transmitted to airline safety dispatchers or logged in the voyage log.

2. Authoritative document:
SOP-OPS-737-04 revised on 2024-03-01 is the active governing policy.

3. Supersession notes:
Prior guidance in SOP-OPS-737-03 was retired and replaced due to updated altitude restrictions.
```

---

## Task 2 — Capping Output Length with `max_tokens`

The goal is to verify that setting `max_tokens` (`maxOutputTokens`) caps the response length to prevent runaway generation and limit API billing costs.

### Comparison Table

| Configured Limit | Resulting Characters | Est. Output Tokens | Status | Behavioral Impact |
|---|---|---|---|---|
| **30 tokens** | ~120 chars | ~30 tokens | Truncated | Hard cut-off mid-thought. Protects against excessive token billing. |
| **100 tokens** | ~350 chars | ~88 tokens | Concise | Answers the direct challenge/response succinctly without excess. |
| **400 tokens** | ~850 chars | ~215 tokens | Complete | Complete 3-part structured answer including citations and supersession. |

### Output Samples

#### `max_tokens = 30` (Budget Cap)
```text
1. Direct answer:
Under approved SOP-OPS-737-04, the sterile cockpit rule applies below 10,000 feet MSL. If a deviation ... [TRUNCATED: Exceeded max_tokens limit of 30]
```

#### `max_tokens = 100` (Concise Cap)
```text
1. Direct answer:
Under approved SOP-OPS-737-04, the sterile cockpit rule applies below 10,000 feet MSL. If a deviation occurs:
- The observing crew member must immediately issue the standardized verbal challenge: "STERILE COCKPIT".
- The active crew member must immediately cease non-essential activity and respond: "STERILE COCKPIT COPIED".
- Any persistent or safety-compromising deviation must be... [TRUNCATED: Exceeded max_tokens limit of 100]
```

#### `max_tokens = 400` (Full Standard Cap)
```text
1. Direct answer:
Under approved SOP-OPS-737-04, the sterile cockpit rule applies below 10,000 feet MSL. If a deviation occurs:
- The observing crew member must immediately issue the standardized verbal challenge: "STERILE COCKPIT".
- The active crew member must immediately cease non-essential activity and respond: "STERILE COCKPIT COPIED".
- Any persistent or safety-compromising deviation must be logged in the Captain's Voyage Report after the flight.

2. Authoritative document:
SOP-OPS-737-04 (Boeing 737 Sterile Cockpit and Critical Phase Procedures, Effective Date: 2024-03-01, Status: APPROVED).

3. Supersession notes:
SOP-OPS-737-03 (effective 2021-06-15) recommended sterile cockpit below 8,000 feet, but is SUPERSEDED and must not be used for operational procedures.
```

---

## Task 3 — Testing Additional Parameters (`stop` & `top_p`)

### 1. Stop Sequences (`stopSequences`)
- **Configured Stop Sequence:** `["\n3. Supersession notes:"]`
- **Objective:** Prevent the model from continuing into section 3 if the caller only requires the direct answer and authoritative document citation.

#### Before (No Stop Sequence):
```text
1. Direct answer:
Under approved SOP-OPS-737-04, the sterile cockpit rule applies below 10,000 feet MSL. If a deviation occurs:
- The observing crew member must immediately issue the standardized verbal challenge: "STERILE COCKPIT".
- The active crew member must immediately cease non-essential activity and respond: "STERILE COCKPIT COPIED".
- Any persistent or safety-compromising deviation must be logged in the Captain's Voyage Report after the flight.

2. Authoritative document:
SOP-OPS-737-04 (Boeing 737 Sterile Cockpit and Critical Phase Procedures, Effective Date: 2024-03-01, Status: APPROVED).

3. Supersession notes:
SOP-OPS-737-03 (effective 2021-06-15) recommended sterile cockpit below 8,000 feet, but is SUPERSEDED and must not be used for operational procedures.
```

#### After (With Stop Sequence applied):
```text
1. Direct answer:
Under approved SOP-OPS-737-04, the sterile cockpit rule applies below 10,000 feet MSL. If a deviation occurs:
- The observing crew member must immediately issue the standardized verbal challenge: "STERILE COCKPIT".
- The active crew member must immediately cease non-essential activity and respond: "STERILE COCKPIT COPIED".
- Any persistent or safety-compromising deviation must be logged in the Captain's Voyage Report after the flight.

2. Authoritative document:
SOP-OPS-737-04 (Boeing 737 Sterile Cockpit and Critical Phase Procedures, Effective Date: 2024-03-01, Status: APPROVED).

[GENERATION HALTED: Matched stop sequence "
3. Supersession notes:"]
```
*Observation:* The model instantly terminated generation when reaching `3. Supersession notes:`, ensuring tight boundaries and zero extra tokens spent.

### 2. Nucleus Sampling (`top_p`)
- **Comparison:** `top_p = 0.1` vs `top_p = 0.95` (at `temperature = 0.7`)
- **Observation:**
  - At `top_p = 0.1`, the model only samples from the top 10% probability mass, resulting in very conservative token choices close to low temperature behavior.
  - At `top_p = 0.95`, the model considers tokens across the 95% cumulative probability mass, allowing a wider variety of vocabulary and sentence structures.

---

## Key Takeaways for Reviewers
1. **Low Temperature ($0.0 - 0.2$)** is mandatory for factual airline safety and procedure verification where predictability and context adherence are mission critical.
2. **Sensible `max_tokens` ($300 - 500$)** prevents runaway generation loops and protects operational budget.
3. **Stop Sequences** provide deterministic termination boundaries to guarantee that generation halts without bleeding into unwanted sections.
