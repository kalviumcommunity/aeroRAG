# Similarity Metrics & Embedding Quality Evaluation Report

**Evaluation Date:** 2026-11-02T08:47:44.818Z
**Status:** ✅ PASSED
**Embedding Model:** `mock-text-embedding-004` (768 dims)

> [!IMPORTANT]
> **Safety Invariant:** Semantic similarity scores measure lexical/embedding vector proximity only. Similarity alone DOES NOT establish operational validity, regulatory compliance, aircraft effectivity, or flight crew safety approval.

## Executive Summary

| Metric | Value | Baseline / Threshold | Status |
| :--- | :--- | :--- | :--- |
| **Queries Evaluated** | 5 | N/A | Completed |
| **Corpus Chunks** | 12 | N/A | Indexed |
| **Top-1 Accuracy** | 80.0% | >= 80.0% | PASS |
| **Mean Related Similarity** | 0.424293 | >= 0.650 | WARN |
| **Mean Unrelated Similarity** | 0.039119 | <= 0.400 | PASS |
| **Separation Margin** | +0.385174 | >= +0.2 | PASS |

## Vector Numerical Integrity Audit

- **Total Vectors Audited:** 12
- **Valid Number Formats:** 12 / 12
- **Zero Vectors Detected:** 0
- **Unit-Normalized (L2 = 1.0):** 12 / 12
- **Non-Finite (NaN / Inf):** None
- **Dimensional Integrity:** VERIFIED

## Anomalies & Observations Reported for Investigation

### ℹ️ [MEDIUM] LOW_PROCEDURAL_SIMILARITY
- **Query:** "What is the initial memory action for emergency descent rapid depressurization?" (`query-emergency-descent`)
- **Description:** Procedural chunk similarity (0.311508) is below minimum benchmark expectation (0.35).

### ⚠️ [SAFETY_WARNING] SUPERSEDED_PROCEDURE_RANKED_FIRST
- **Query:** "Can we take credit for reverse thrust on contaminated runway takeoff distance calculation?" (`query-contaminated-runway-trap`)
- **Description:** SAFETY ALERT: Superseded checklist/procedure "chunk-proc-runway-superseded" ranked #1 due to strong semantic similarity (0.492692). High similarity does NOT certify current operational validity.

## Query Ranking Breakdown

### Query: "What is the initial memory action for emergency descent rapid depressurization?"
- **Expected Target:** `chunk-proc-emergency-descent` (Similarity: 0.311508)
- **Top Ranked:** `chunk-proc-emergency-descent` (Match)
- **Separation vs Unrelated:** +0.26679

| Rank | Chunk ID | Similarity | Status | Section |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `chunk-proc-emergency-descent` | 0.311508 | APPROVED | Emergency Descent |
| 2 | `chunk-unrelated-pet-policy` | 0.044718 | APPROVED | In-Cabin Pets |
| 3 | `chunk-proc-engine-failure-v1` | 0.028985 | APPROVED | Takeoff Engine Failure |
| 4 | `chunk-proc-go-around` | 0.027846 | APPROVED | Go-Around Execution |
| 5 | `chunk-proc-runway-superseded` | 0.026816 | SUPERSEDED [SUPERSEDED] | Contaminated Runway Calculation |

### Query: "What is the procedure for engine failure during takeoff after passing V1 speed?"
- **Expected Target:** `chunk-proc-engine-failure-v1` (Similarity: 0.348126)
- **Top Ranked:** `chunk-proc-engine-failure-v1` (Match)
- **Separation vs Unrelated:** +0.299737

| Rank | Chunk ID | Similarity | Status | Section |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `chunk-proc-engine-failure-v1` | 0.348126 | APPROVED | Takeoff Engine Failure |
| 2 | `chunk-distractor-ground-runup` | 0.138878 | APPROVED | Ground Run-up Pad Procedures |
| 3 | `chunk-proc-sterile-cockpit` | 0.129926 | APPROVED | Sterile Flight Deck |
| 4 | `chunk-proc-runway-current` | 0.102276 | CURRENT | Contaminated Runway Calculation |
| 5 | `chunk-proc-emergency-descent` | 0.07658 | APPROVED | Emergency Descent |

### Query: "When does the sterile flight deck rule apply below 10,000 feet?"
- **Expected Target:** `chunk-proc-sterile-cockpit` (Similarity: 0.426258)
- **Top Ranked:** `chunk-proc-sterile-cockpit` (Match)
- **Separation vs Unrelated:** +0.294826

| Rank | Chunk ID | Similarity | Status | Section |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `chunk-proc-sterile-cockpit` | 0.426258 | APPROVED | Sterile Flight Deck |
| 2 | `chunk-proc-emergency-descent` | 0.152188 | APPROVED | Emergency Descent |
| 3 | `chunk-proc-engine-failure-v1` | 0.13172 | APPROVED | Takeoff Engine Failure |
| 4 | `chunk-unrelated-ife-streaming` | 0.131432 | APPROVED | Wireless Streaming Instructions |
| 5 | `chunk-distractor-oxygen-briefing` | 0.119026 | APPROVED | Pre-flight Safety Demonstration |

### Query: "What are the required pilot flying actions for a go around missed approach?"
- **Expected Target:** `chunk-proc-go-around` (Similarity: 0.549743)
- **Top Ranked:** `chunk-proc-go-around` (Match)
- **Separation vs Unrelated:** +0.486672

| Rank | Chunk ID | Similarity | Status | Section |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `chunk-proc-go-around` | 0.549743 | APPROVED | Go-Around Execution |
| 2 | `chunk-proc-emergency-descent` | 0.167174 | APPROVED | Emergency Descent |
| 3 | `chunk-proc-sterile-cockpit` | 0.113624 | APPROVED | Sterile Flight Deck |
| 4 | `chunk-proc-runway-superseded` | 0.111749 | SUPERSEDED [SUPERSEDED] | Contaminated Runway Calculation |
| 5 | `chunk-unrelated-ife-streaming` | 0.063071 | APPROVED | Wireless Streaming Instructions |

### Query: "Can we take credit for reverse thrust on contaminated runway takeoff distance calculation?"
- **Expected Target:** `chunk-proc-runway-current` (Similarity: 0.485828)
- **Top Ranked:** `chunk-proc-runway-superseded` (Mismatch)
- **Separation vs Unrelated:** +0.422412

| Rank | Chunk ID | Similarity | Status | Section |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `chunk-proc-runway-superseded` | 0.492692 | SUPERSEDED [SUPERSEDED] | Contaminated Runway Calculation |
| 2 | `chunk-proc-runway-current` | 0.485828 | CURRENT | Contaminated Runway Calculation |
| 3 | `chunk-proc-go-around` | 0.155335 | APPROVED | Go-Around Execution |
| 4 | `chunk-proc-sterile-cockpit` | 0.086409 | APPROVED | Sterile Flight Deck |
| 5 | `chunk-proc-emergency-descent` | 0.073036 | APPROVED | Emergency Descent |
