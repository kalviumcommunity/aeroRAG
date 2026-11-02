/**
 * ============================================================================
 * Milestone 3.22: Chunk Metadata, Source Tracking & Document Versioning
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Implements airline-specific document versioning, applicability states,
 * verification tracking, and metadata propagation to chunks.
 *
 * Safety Invariants:
 * 1. Rule 1 (Temporal Invariant): A later publication date alone must NOT
 *    establish that a document supersedes another.
 * 2. Rule 2 (Uncertainty Invariant): Missing or conflicting metadata must
 *    remain visible as explicit uncertainty codes.
 * 3. Rule 3 (Anti-Fabrication Invariant): Do not claim official validity
 *    (VERIFIED_OFFICIAL) without verified approval evidence.
 */

export const DOCUMENT_TYPES = Object.freeze([
  'SOP',                  // Standard Operating Procedure
  'QRH',                  // Quick Reference Handbook
  'FCOM',                 // Flight Crew Operating Manual
  'FCTM',                 // Flight Crew Training Manual
  'SAFETY_BULLETIN',      // Flight Operations Safety Directive / Bulletin
  'REGULATORY_DIRECTIVE', // Airworthiness Directive (AD) / FAA FAR / EASA Rule
  'POLICY',               // Airline Flight Operations Policy
  'OTHER',
  'UNKNOWN'
]);

export const APPLICABILITY_STATUSES = Object.freeze([
  'APPLICABLE',     // Currently active operational authority for flight crews
  'SUPERSEDED',     // Explicitly replaced by newer approved standard (DO NOT FOLLOW)
  'HISTORICAL',     // Archived document, reference only, not active guidance
  'CONDITIONAL',    // Applies only to specific fleets, tail numbers, or conditions
  'EXPIRED',        // Passed expiry date
  'NOT_APPLICABLE', // Explicitly not applicable to this fleet/domain
  'UNKNOWN'         // Uncertain applicability due to missing/conflicting metadata
]);

export const VERIFICATION_STATUSES = Object.freeze([
  'VERIFIED_OFFICIAL', // Explicitly verified approval by authorized authority
  'UNVERIFIED',        // Draft or missing verifiable approval evidence
  'CONFLICTING',       // Conflicting version, date, or operational records
  'PROVISIONAL',       // Interim or temporary operational guidance
  'REVOKED'            // Formally cancelled or withdrawn
]);

export const UNCERTAINTY_CODES = Object.freeze({
  MISSING_EFFECTIVE_DATE: 'MISSING_EFFECTIVE_DATE',
  MISSING_PUBLICATION_DATE: 'MISSING_PUBLICATION_DATE',
  MISSING_DOCUMENT_ID: 'MISSING_DOCUMENT_ID',
  UNVERIFIED_AUTHORITY: 'UNVERIFIED_AUTHORITY',
  DOCUMENT_EXPIRED: 'DOCUMENT_EXPIRED',
  TEMPORAL_SUPERSEDION_DISALLOWED: 'TEMPORAL_SUPERSEDION_DISALLOWED',
  CONFLICTING_VERSION_METADATA: 'CONFLICTING_VERSION_METADATA',
  AMBIGUOUS_APPLICABILITY: 'AMBIGUOUS_APPLICABILITY'
});

/**
 * Validates and normalizes document-level metadata.
 *
 * Enforces key aviation safety rules:
 * - Rule 1: A later publication date alone must NOT establish supersession without explicit evidence.
 * - Rule 2: Missing or conflicting metadata must remain visible as explicit uncertainties.
 * - Rule 3: Do not claim official validity (VERIFIED_OFFICIAL) without verified approval evidence.
 *
 * @param {Object} raw - Raw input metadata.
 * @param {Object} [options] - Validation options (e.g. currentDate for expiry testing).
 * @returns {Object} Validated and normalized document metadata record.
 */
export function validateDocumentMetadata(raw = {}, options = {}) {
  const uncertainties = [];
  const currentDate = options.currentDate ? new Date(options.currentDate) : new Date();

  // 1. Document ID
  let documentId = (raw.documentId || raw.id || '').trim();
  if (!documentId) {
    documentId = `DOC_UNKNOWN_${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    uncertainties.push(UNCERTAINTY_CODES.MISSING_DOCUMENT_ID);
  }

  // 2. Title
  const title = (raw.title || raw.documentTitle || 'Untitled Operational Document').trim();

  // 3. Document Type
  let documentType = (raw.documentType || 'UNKNOWN').toUpperCase().replace(/\s+/g, '_');
  if (documentType === 'OPERATIONAL_MANUAL') documentType = 'SOP';
  if (documentType === 'SAFETY_DIRECTIVE') documentType = 'SAFETY_BULLETIN';
  if (!DOCUMENT_TYPES.includes(documentType)) {
    documentType = 'UNKNOWN';
  }

  // 4. Source / Authority
  const source = (raw.source || raw.publisher || raw.organization || 'Unspecified Authority').trim();

  // 5. Version / Revision
  const version = (raw.version || raw.revision || '1.0').trim();

  // 6. Dates (Publication, Effective, Expiry)
  let publicationDate = null;
  if (raw.publicationDate || raw.issueDate) {
    const d = new Date(raw.publicationDate || raw.issueDate);
    if (!isNaN(d.getTime())) {
      publicationDate = d.toISOString();
    }
  }
  if (!publicationDate) {
    uncertainties.push(UNCERTAINTY_CODES.MISSING_PUBLICATION_DATE);
  }

  let effectiveDate = null;
  if (raw.effectiveDate) {
    const d = new Date(raw.effectiveDate);
    if (!isNaN(d.getTime())) {
      effectiveDate = d.toISOString();
    }
  }
  if (!effectiveDate) {
    uncertainties.push(UNCERTAINTY_CODES.MISSING_EFFECTIVE_DATE);
  }

  let expiryDate = null;
  if (raw.expiryDate) {
    const d = new Date(raw.expiryDate);
    if (!isNaN(d.getTime())) {
      expiryDate = d.toISOString();
    }
  }

  // Check if expired
  let isExpired = false;
  if (expiryDate && new Date(expiryDate) < currentDate) {
    isExpired = true;
    uncertainties.push(UNCERTAINTY_CODES.DOCUMENT_EXPIRED);
  }

  // 7. Explicit Supersession Arrays
  const supersedes = Array.isArray(raw.supersedes)
    ? raw.supersedes.map(s => String(s).trim()).filter(Boolean)
    : (raw.supersedes ? [String(raw.supersedes).trim()] : []);

  const supersededBy = raw.supersededBy ? String(raw.supersededBy).trim() : null;

  // 8. Verification Status
  // Rule: Do not claim official validity without evidence!
  const approvalStatus = (raw.approvalStatus || raw.status || '').toUpperCase();
  const approvedBy = (raw.approvedBy || raw.approvalAuthority || '').trim();
  const hasOfficialEvidence = (
    (approvalStatus === 'APPROVED' || approvalStatus === 'ACTIVE' || approvalStatus === 'OFFICIAL') &&
    (approvedBy.length > 0 || (source && source !== 'Unspecified Authority'))
  );

  let verificationStatus = raw.verificationStatus ? raw.verificationStatus.toUpperCase() : null;
  if (!verificationStatus || !VERIFICATION_STATUSES.includes(verificationStatus)) {
    if (raw.isConflicting) {
      verificationStatus = 'CONFLICTING';
    } else if (hasOfficialEvidence) {
      verificationStatus = 'VERIFIED_OFFICIAL';
    } else {
      verificationStatus = 'UNVERIFIED';
      uncertainties.push(UNCERTAINTY_CODES.UNVERIFIED_AUTHORITY);
    }
  }

  // 9. Applicability Status
  let applicabilityStatus = raw.applicabilityStatus ? raw.applicabilityStatus.toUpperCase() : null;
  if (!applicabilityStatus || !APPLICABILITY_STATUSES.includes(applicabilityStatus)) {
    if (supersededBy) {
      applicabilityStatus = 'SUPERSEDED';
    } else if (isExpired) {
      applicabilityStatus = 'EXPIRED';
    } else if (approvalStatus === 'ARCHIVED' || approvalStatus === 'HISTORICAL') {
      applicabilityStatus = 'HISTORICAL';
    } else if (raw.isConditional || raw.conditions || approvalStatus === 'CONDITIONAL') {
      applicabilityStatus = 'CONDITIONAL';
    } else if (hasOfficialEvidence && !uncertainties.includes(UNCERTAINTY_CODES.MISSING_EFFECTIVE_DATE)) {
      applicabilityStatus = 'APPLICABLE';
    } else {
      applicabilityStatus = 'UNKNOWN';
      uncertainties.push(UNCERTAINTY_CODES.AMBIGUOUS_APPLICABILITY);
    }
  }

  // Merge any custom uncertainties passed in
  if (Array.isArray(raw.uncertainties)) {
    for (const u of raw.uncertainties) {
      if (!uncertainties.includes(u)) {
        uncertainties.push(u);
      }
    }
  }

  return {
    ...raw,
    documentId,
    title,
    documentType,
    source,
    version,
    publicationDate,
    effectiveDate,
    expiryDate,
    supersedes,
    supersededBy,
    applicabilityStatus,
    verificationStatus,
    approvalAuthority: approvedBy || (hasOfficialEvidence ? source : null),
    fleetApplicability: raw.fleetApplicability || raw.fleet || 'ALL',
    uncertainties,
    isUncertain: uncertainties.length > 0
  };
}

/**
 * Formats a standardized human-readable citation string from chunk metadata.
 *
 * @param {Object} meta - Chunk metadata object.
 * @returns {string} Human-readable citation.
 */
export function formatChunkCitation(meta = {}) {
  const docId = meta.documentId || 'DOC';
  const ver = meta.version ? ` (${meta.version})` : '';
  const sectionPart = meta.sectionTitle ? `, Section: "${meta.sectionTitle}"` : '';
  const pagePart = meta.page !== undefined ? `, p. ${meta.page}` : '';
  const effDate = meta.effectiveDate ? `, Eff: ${meta.effectiveDate.split('T')[0]}` : '';
  const pubDate = (!effDate && meta.publicationDate) ? `, Pub: ${meta.publicationDate.split('T')[0]}` : '';
  const statusPart = (meta.applicabilityStatus || meta.verificationStatus)
    ? ` [${meta.applicabilityStatus || 'UNKNOWN'} / ${meta.verificationStatus || 'UNVERIFIED'}]`
    : '';

  return `${docId}${ver}${sectionPart}${pagePart}${effDate}${pubDate}${statusPart}`;
}

/**
 * Propagates document-level metadata to individual chunks and formats official citation.
 *
 * @param {Object} documentMetadata - Document metadata from validateDocumentMetadata.
 * @param {Array<Object>} chunks - Chunk records from chunker.js.
 * @returns {Array<Object>} Enriched chunks with propagated source tracking and citations.
 */
export function propagateMetadataToChunks(documentMetadata, chunks = []) {
  if (!Array.isArray(chunks)) return [];
  const doc = validateDocumentMetadata(documentMetadata);

  return chunks.map((chunk, idx) => {
    const chunkIndex = typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : idx;
    const chunkId = `${doc.documentId}_chunk_${chunkIndex}`;

    // Extract section / heading info from existing chunk metadata
    const existingMeta = chunk.metadata || {};
    const sectionTitle = existingMeta.sectionTitle ||
      (existingMeta.headings && existingMeta.headings.length > 0 ? existingMeta.headings[existingMeta.headings.length - 1] : null);
    const headings = existingMeta.headings || [];
    const page = existingMeta.page !== undefined ? existingMeta.page : (chunk.page || 1);

    const chunkMetaForCitation = {
      documentId: doc.documentId,
      version: doc.version,
      sectionTitle,
      page,
      effectiveDate: doc.effectiveDate,
      publicationDate: doc.publicationDate,
      applicabilityStatus: doc.applicabilityStatus,
      verificationStatus: doc.verificationStatus
    };

    const citation = formatChunkCitation(chunkMetaForCitation);

    return {
      ...chunk,
      id: chunkId,
      chunkIndex,
      metadata: {
        ...existingMeta,
        ...doc,
        // Document Identity & Source Tracking
        documentId: doc.documentId,
        title: doc.title,
        documentType: doc.documentType,
        source: doc.source,
        version: doc.version,
        publicationDate: doc.publicationDate,
        effectiveDate: doc.effectiveDate,
        expiryDate: doc.expiryDate,
        fleetApplicability: doc.fleetApplicability,
        // Versioning & Supersession
        supersedes: doc.supersedes,
        supersededBy: doc.supersededBy,
        // Verification & Uncertainty
        applicabilityStatus: doc.applicabilityStatus,
        verificationStatus: doc.verificationStatus,
        approvalAuthority: doc.approvalAuthority,
        uncertainties: doc.uncertainties,
        isUncertain: doc.isUncertain,
        // Location & Citation
        page,
        sectionTitle,
        headings,
        citation
      }
    };
  });
}

/**
 * Resolves supersession relationships across a collection of documents.
 *
 * Implements airline-specific versioning rules:
 * - A later publication date ALONE does not establish supersession.
 * - Explicit supersession requires either:
 *   1. Explicit `supersedes` declaration matching target documentId or title.
 *   2. Same documentId with verified higher version / effective date.
 * - Conflicting records without supersession linkage remain flagged as CONFLICTING with uncertainty.
 *
 * @param {Array<Object>} documents - Array of document metadata objects.
 * @param {Object} [options] - Resolution options (e.g. currentDate).
 * @returns {Array<Object>} Updated document records with resolved relationships and explicit uncertainties.
 */
export function resolveDocumentRelationships(documents = [], options = {}) {
  if (!Array.isArray(documents) || documents.length === 0) return [];

  const validatedDocs = documents.map((d, index) => ({
    ...validateDocumentMetadata(d, options),
    _internalId: `${d.documentId || d.id || 'DOC'}_v_${d.version || '1.0'}_${index}`
  }));

  // 1. Process explicit supersedes links
  for (const doc of validatedDocs) {
    if (doc.supersedes && doc.supersedes.length > 0) {
      for (const supersededTarget of doc.supersedes) {
        for (const target of validatedDocs) {
          if (target._internalId === doc._internalId) continue;
          if (
            target.documentId === supersededTarget ||
            target.title === supersededTarget ||
            `${target.documentId} ${target.version}` === supersededTarget ||
            `${target.documentId} (${target.version})` === supersededTarget
          ) {
            target.supersededBy = `${doc.documentId} (${doc.version})`;
            target.applicabilityStatus = 'SUPERSEDED';
          }
        }
      }
    }
  }

  // 2. Process documents sharing identical documentId (Version Bumps)
  const groupedById = new Map();
  for (const doc of validatedDocs) {
    if (!groupedById.has(doc.documentId)) {
      groupedById.set(doc.documentId, []);
    }
    groupedById.get(doc.documentId).push(doc);
  }

  for (const [id, versions] of groupedById.entries()) {
    if (versions.length > 1) {
      // Sort versions by effective date, then publication date, then version string
      versions.sort((a, b) => {
        const dateA = new Date(a.effectiveDate || a.publicationDate || 0);
        const dateB = new Date(b.effectiveDate || b.publicationDate || 0);
        if (dateB - dateA !== 0) return dateB - dateA;
        return String(b.version).localeCompare(String(a.version));
      });

      const newest = versions[0];

      for (let i = 1; i < versions.length; i++) {
        const older = versions[i];
        if (newest.verificationStatus === 'VERIFIED_OFFICIAL') {
          older.supersededBy = `${newest.documentId} (${newest.version})`;
          older.applicabilityStatus = 'SUPERSEDED';
          const ref = `${older.documentId} (${older.version})`;
          if (!newest.supersedes.includes(older.version) && !newest.supersedes.includes(ref)) {
            newest.supersedes.push(ref);
          }
        } else {
          // If newest is unverified, DO NOT supersede older official document!
          older.uncertainties.push(UNCERTAINTY_CODES.CONFLICTING_VERSION_METADATA);
          newest.uncertainties.push(UNCERTAINTY_CODES.UNVERIFIED_AUTHORITY);
          older.isUncertain = true;
          newest.isUncertain = true;
        }
      }
    }
  }

  // 3. Evaluate Temporal Invariant: Later publication date WITHOUT explicit supersession
  // For distinct document IDs of the same type and fleet that both claim APPLICABLE
  for (let i = 0; i < validatedDocs.length; i++) {
    for (let j = 0; j < validatedDocs.length; j++) {
      if (i === j) continue;
      const docA = validatedDocs[i];
      const docB = validatedDocs[j];

      // If docB was published later than docA, but different documentId and no explicit supersedes link
      if (
        docA.documentId !== docB.documentId &&
        docB.publicationDate && docA.publicationDate &&
        new Date(docB.publicationDate) > new Date(docA.publicationDate) &&
        !docB.supersedes.includes(docA.documentId) &&
        docA.supersededBy !== docB.documentId &&
        (!docA.supersededBy || !docA.supersededBy.startsWith(docB.documentId)) &&
        docA.applicabilityStatus === 'APPLICABLE' &&
        docB.applicabilityStatus === 'APPLICABLE' &&
        docA.fleetApplicability === docB.fleetApplicability &&
        docA.documentType === docB.documentType
      ) {
        // Both claim APPLICABLE for same fleet and type, but no supersession linkage!
        const msg = `${UNCERTAINTY_CODES.TEMPORAL_SUPERSEDION_DISALLOWED}: Document ${docB.documentId} has later publication date than ${docA.documentId}, but does not explicitly supersede it.`;
        if (!docA.uncertainties.includes(msg)) docA.uncertainties.push(msg);
        if (!docB.uncertainties.includes(msg)) docB.uncertainties.push(msg);

        // Flag as conflicting since both active documents govern the exact same fleet/domain without supersession
        docA.verificationStatus = 'CONFLICTING';
        docB.verificationStatus = 'CONFLICTING';
        docA.applicabilityStatus = 'UNKNOWN';
        docB.applicabilityStatus = 'UNKNOWN';
        docA.isUncertain = true;
        docB.isUncertain = true;
      }
    }
  }

  // Remove internal helper key
  return validatedDocs.map(d => {
    const { _internalId, ...rest } = d;
    return rest;
  });
}
