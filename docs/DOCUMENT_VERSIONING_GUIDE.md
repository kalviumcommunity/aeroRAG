# Airline Procedure Intelligence: Document Versioning & Metadata Guide

## Milestone 3.22 — Chunk Metadata, Source Tracking & Document Versioning

In commercial aviation flight operations, document management is safety-critical. Following an expired, superseded, or unofficial procedure can lead to non-compliance or catastrophic flight safety hazards. Conversely, rejecting a valid procedure due to naive assumptions can deprive aircrews of essential guidance.

This guide details the metadata schemas, applicability states, verification states, supersession resolution engine, and chunk propagation mechanisms implemented in **Milestone 3.22**.

---

## 1. Safety Invariants

The versioning and metadata management engine strictly enforces three core safety invariants:

| Safety Invariant | Rule | Rationale |
| :--- | :--- | :--- |
| **Rule 1: Temporal Invariant** | A later publication date ALONE must **NOT** establish that a document supersedes another. | General guidance (e.g. Flight Crew Training Manual Rev 5 published in 2024) does not supersede aircraft-specific Standard Operating Procedures (e.g. B737 SOP Rev 4 published in 2023). Supersession requires explicit declaration or identical authority lineage. |
| **Rule 2: Uncertainty Invariant** | Missing or conflicting metadata must remain visible as explicit uncertainty codes. | Never disguise ambiguous, unverified, or contradictory documents as settled facts. Downstream RAG reasoning and flight crews must clearly see missing dates, unverified authorities, or contradictory directives. |
| **Rule 3: Anti-Fabrication Invariant** | Do **NOT** claim official validity (`VERIFIED_OFFICIAL`) without documented approval evidence. | Drafts, unofficial notes, or documents lacking documented approval authority must be classified as `UNVERIFIED` and barred from claiming active official validity. |

---

## 2. Metadata Schema

Every operational document ingested into the aeroRAG pipeline is validated and normalized to the following metadata schema:

```typescript
interface DocumentMetadata {
  documentId: string;                // e.g. "SOP-OPS-737-04"
  title: string;                     // e.g. "B737 Standard Operating Procedures"
  documentType: DocumentType;        // SOP, QRH, FCOM, FCTM, SAFETY_BULLETIN, etc.
  source: string;                    // e.g. "Flight Operations Directorate"
  version: string;                   // e.g. "Rev 4.0", "Issue 2"
  publicationDate: string | null;    // ISO 8601 string or null
  effectiveDate: string | null;      // ISO 8601 string or null
  expiryDate: string | null;         // ISO 8601 string or null (if supplied)
  fleetApplicability: string;        // e.g. "B737-800", "A320neo", "ALL"
  supersedes: string[];              // List of document IDs or versions explicitly superseded
  supersededBy: string | null;       // Document ID and version that supersedes this document
  applicabilityStatus: ApplicabilityStatus; // APPLICABLE, SUPERSEDED, etc.
  verificationStatus: VerificationStatus;   // VERIFIED_OFFICIAL, UNVERIFIED, etc.
  approvalAuthority: string | null;  // Authorized signing official or authority
  uncertainties: string[];           // List of UNCERTAINTY_CODES
  isUncertain: boolean;              // True if any uncertainties or conflicts exist
}
```

---

## 3. Status Enums

### Document Types (`DOCUMENT_TYPES`)
- `SOP`: Standard Operating Procedure
- `QRH`: Quick Reference Handbook (Non-Normal / Emergency Checklists)
- `FCOM`: Flight Crew Operating Manual
- `FCTM`: Flight Crew Training Manual
- `SAFETY_BULLETIN`: Flight Operations Safety Directive / Bulletin / OEB
- `REGULATORY_DIRECTIVE`: Airworthiness Directive (AD) / FAA FAR / EASA Rule
- `POLICY`: Flight Operations Policy
- `OTHER` / `UNKNOWN`: Unclassified manuals

### Applicability Statuses (`APPLICABILITY_STATUSES`)
- `APPLICABLE`: Currently active operational authority for flight crews.
- `SUPERSEDED`: Explicitly replaced by newer approved standard (**DO NOT FOLLOW**).
- `HISTORICAL`: Archived document, reference only, not active guidance.
- `CONDITIONAL`: Applies only under specific weather, fleet, or operational conditions.
- `EXPIRED`: Passed expiry date (e.g. temporary NOTAM or seasonal directive).
- `NOT_APPLICABLE`: Explicitly excluded from the active aircraft domain.
- `UNKNOWN`: Uncertain applicability due to missing dates or unverified lineage.

### Verification Statuses (`VERIFICATION_STATUSES`)
- `VERIFIED_OFFICIAL`: Document has verified approval by an authorized operational authority.
- `UNVERIFIED`: Missing verifiable approval evidence or unapproved draft.
- `CONFLICTING`: Conflicting version, contradictory directive, or ambiguous supersession.
- `PROVISIONAL`: Interim or temporary operational guidance pending final ratification.
- `REVOKED`: Formally withdrawn or cancelled.

### Uncertainty Codes (`UNCERTAINTY_CODES`)
- `MISSING_DOCUMENT_ID`: Document ID was omitted; fallback identifier generated.
- `MISSING_PUBLICATION_DATE`: Publication / issue date omitted.
- `MISSING_EFFECTIVE_DATE`: Effective date omitted.
- `UNVERIFIED_AUTHORITY`: Missing documented approval official or authority.
- `DOCUMENT_EXPIRED`: Document has exceeded its stated expiry date.
- `TEMPORAL_SUPERSEDION_DISALLOWED`: Newer publication date detected without explicit supersession linkage.
- `CONFLICTING_VERSION_METADATA`: Incompatible or contradictory versions detected.
- `AMBIGUOUS_APPLICABILITY`: Document status cannot be determined definitively.

---

## 4. Metadata Propagation to Chunks & Citations

When documents are partitioned into text chunks (via `chunkText` or `DocumentChunker`), document-level metadata propagates seamlessly to each chunk.

### Chunk Output Structure
```javascript
{
  id: "SOP-OPS-737-04_chunk_0",
  chunkIndex: 0,
  text: "Both pilots must crosscheck altimeters prior to departure...",
  metadata: {
    // Document Identity & Source Tracking
    documentId: "SOP-OPS-737-04",
    title: "B737 Standard Operating Procedures",
    documentType: "SOP",
    source: "Flight Operations Directorate",
    version: "Rev 4",
    publicationDate: "2024-02-15T00:00:00.000Z",
    effectiveDate: "2024-03-01T00:00:00.000Z",
    expiryDate: null,
    fleetApplicability: "B737-800",
    // Supersession Tracking
    supersedes: [],
    supersededBy: null,
    // Verification & Uncertainty
    applicabilityStatus: "APPLICABLE",
    verificationStatus: "VERIFIED_OFFICIAL",
    approvalAuthority: "VP Flight Operations",
    uncertainties: [],
    isUncertain: false,
    // Location & Citation
    page: 12,
    sectionTitle: "Altimeter Setting Procedures",
    headings: ["Standard Operating Procedures", "Pre-Flight", "Altimeter Setting Procedures"],
    citation: "SOP-OPS-737-04 (Rev 4), Section: \"Altimeter Setting Procedures\", p. 12, Eff: 2024-03-01 [APPLICABLE / VERIFIED_OFFICIAL]"
  }
}
```

---

## 5. Supersession Resolution Logic

The `resolveDocumentRelationships(documents, options)` function processes document collections:

1. **Explicit Supersession (`supersedes`)**:
   - If Document B explicitly declares `supersedes: ['SOP-DEICE-2022']`, `SOP-DEICE-2022` is marked `SUPERSEDED` with `supersededBy: 'SOP-DEICE-2024 (2.0)'`.
2. **Version Bumps on Identical Document ID**:
   - When multiple records share the same `documentId`, versions are compared.
   - If the newer version has verified approval authority, older versions are marked `SUPERSEDED`.
   - If the newer version is unverified (draft), it **does not** supersede the older official version; both are flagged with `CONFLICTING_VERSION_METADATA` and `UNVERIFIED_AUTHORITY`.
3. **Temporal Invariant Safeguard**:
   - If two documents of the same fleet and domain have different IDs, and one was published later than the other with **no explicit supersedes link**, the system does **not** assume supersession.
   - Both documents are flagged with `TEMPORAL_SUPERSEDION_DISALLOWED`, marked `CONFLICTING` and `UNKNOWN`, requiring human review.

---

## 6. Usage Example

```javascript
import {
  validateDocumentMetadata,
  propagateMetadataToChunks,
  resolveDocumentRelationships
} from './src/rag/metadataManager.js';
import { chunkText } from './src/rag/chunker.js';

// 1. Validate Document Metadata
const docMeta = validateDocumentMetadata({
  documentId: 'SOP-OPS-737-04',
  title: 'B737 Standard Operating Procedures',
  version: 'Rev 4',
  effectiveDate: '2024-03-01',
  approvalStatus: 'APPROVED',
  approvedBy: 'Chief Pilot'
});

// 2. Chunk with Metadata Propagation
const chunks = chunkText(procedureText, {
  documentMetadata: docMeta,
  maxChunkSize: 300
});

console.log(chunks[0].metadata.citation);
// Output: SOP-OPS-737-04 (Rev 4), Section: "Pre-Flight Procedures", p. 1, Eff: 2024-03-01 [APPLICABLE / VERIFIED_OFFICIAL]
```
