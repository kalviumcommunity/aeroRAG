# AeroRAG evaluation results

- **Run time:** 2026-10-23T08:51:38.595Z
- **Mode:** DEMO_MODE (offline mock generation)
- **Dataset:** AeroRAG airline procedure smoke evaluation (5 cases)
- **Indexed context:** 1 fixture chunk(s)

## Overall scores

| Correctness | Grounding | Citation accuracy | Citation precision | Citation recall |
|---:|---:|---:|---:|---:|
| 10.0% | 20.0% | 0.0% | 0.0% | 0.0% |

Scores are means of per-case correctness, grounding, and citation accuracy. Correctness measures expected-fact coverage (or successful abstention). Grounding measures whether matched expected claims have supporting retrieved evidence. A citation is accurate only if its document ID is expected and the retrieved chunk supports the case evidence. These are deterministic lexical checks, not a substitute for expert review.

## Case results

| Case | Answerable | Correctness | Grounding | Citation accuracy | Retrieved chunks |
|---|:---:|---:|---:|---:|---:|
| sterile-cockpit-altitude | Yes | 0.0% | 0.0% | 0.0% | 1 |
| sterile-cockpit-prohibited-activity | Yes | 0.0% | 0.0% | 0.0% | 1 |
| sterile-cockpit-document-source | Yes | 50.0% | 100.0% | 0.0% | 1 |
| sterile-cockpit-challenge-callout | No | 0.0% | 0.0% | 0.0% | 1 |
| fuel-reserve | No | 0.0% | 0.0% | 0.0% | 1 |

## Notable failures and likely causes

- Evaluation ran in DEMO_MODE; answers are produced by the deterministic mock generator, not a live language model.
- sterile-cockpit-altitude: emitted source metadata has no documentId, so citation identity cannot be verified.
- sterile-cockpit-prohibited-activity: emitted source metadata has no documentId, so citation identity cannot be verified.
- sterile-cockpit-document-source: emitted source metadata has no documentId, so citation identity cannot be verified.
- sterile-cockpit-challenge-callout: the system did not abstain although the indexed context contains no answer.
- fuel-reserve: the system did not abstain although the indexed context contains no answer.

The checked-in vector-store fixture contains only one short sterile-cockpit chunk. It does not contain the exact challenge callout or fuel-reserve information, so those cases should abstain. Source metadata in this fixture uses `source` and `document_title`, while the pipeline source mapping reads `documentId` and `documentTitle`; this can cause the emitted citation to lose its document ID/title. Demo answers are generic and are not suitable evidence of live-model quality.

## Per-case details

### sterile-cockpit-altitude

- **Question:** At what altitude does the sterile cockpit rule apply?
- **Expected answer:** The rule applies below 10,000 feet MSL.
- **System answer:** [MOCK ANSWER - DEMO MODE] 1. Direct answer: Based on the retrieved mock data, the requested procedure is covered in the following documents. 2. Authoritative documents: undefined - undefined (Status: APPROVED) 3. Supersession notes: Please verify the status of these documents carefully.
- **Expected sources:** SOP-OPS-737-04
- **Emitted citations:** (missing documentId)
- **Fact checks:** altitude-threshold: answer missing, evidence retrieved

### sterile-cockpit-prohibited-activity

- **Question:** What kind of communication is prohibited during sterile cockpit conditions?
- **Expected answer:** Non-essential communication is prohibited.
- **System answer:** [MOCK ANSWER - DEMO MODE] 1. Direct answer: Based on the retrieved mock data, the requested procedure is covered in the following documents. 2. Authoritative documents: undefined - undefined (Status: APPROVED) 3. Supersession notes: Please verify the status of these documents carefully.
- **Expected sources:** SOP-OPS-737-04
- **Emitted citations:** (missing documentId)
- **Fact checks:** non-essential-communication: answer missing, evidence retrieved

### sterile-cockpit-document-source

- **Question:** Which approved document contains the sterile cockpit altitude rule?
- **Expected answer:** SOP-OPS-737-04, Boeing 737 Sterile Cockpit Procedures, status APPROVED.
- **System answer:** [MOCK ANSWER - DEMO MODE] 1. Direct answer: Based on the retrieved mock data, the requested procedure is covered in the following documents. 2. Authoritative documents: undefined - undefined (Status: APPROVED) 3. Supersession notes: Please verify the status of these documents carefully.
- **Expected sources:** SOP-OPS-737-04
- **Emitted citations:** (missing documentId)
- **Fact checks:** source-document-id: answer missing, evidence retrieved; source-document-status: answer matched, evidence retrieved

### sterile-cockpit-challenge-callout

- **Question:** What exact challenge phrase must a crew member say when sterile cockpit is violated?
- **Expected answer:** I could not find sufficient information in the available airline documents.
- **System answer:** [MOCK ANSWER - DEMO MODE] 1. Direct answer: Based on the retrieved mock data, the requested procedure is covered in the following documents. 2. Authoritative documents: undefined - undefined (Status: APPROVED) 3. Supersession notes: Please verify the status of these documents carefully.
- **Expected sources:** (none)
- **Emitted citations:** (missing documentId)
- **Fact checks:** (abstention case)

### fuel-reserve

- **Question:** What is the required IFR alternate fuel reserve?
- **Expected answer:** I could not find sufficient information in the available airline documents.
- **System answer:** [MOCK ANSWER - DEMO MODE] 1. Direct answer: Based on the retrieved mock data, the requested procedure is covered in the following documents. 2. Authoritative documents: undefined - undefined (Status: APPROVED) 3. Supersession notes: Please verify the status of these documents carefully.
- **Expected sources:** (none)
- **Emitted citations:** (missing documentId)
- **Fact checks:** (abstention case)

## Reproduction

From the repository root, run `npm --prefix backend run evaluate:rag`. The runner forces `DEMO_MODE=true`, uses the checked-in local vector store, and rewrites this report and `rag_evaluation_results.json`.
