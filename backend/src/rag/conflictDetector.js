/**
 * AeroRAG Conflict & Supersession Detection Engine
 * 
 * Aviation safety requires zero tolerance for outdated or conflicting procedures.
 * This engine analyzes retrieved chunks and document metadata to:
 * 1. Detect superseded documents and identify the authoritative successor
 * 2. Detect expired documents
 * 3. Detect unapproved draft procedures
 * 4. Detect concurrent or overlapping documents with potential divergences
 * 5. Generate high-visibility warnings and recommendations for ground staff
 */

/**
 * Normalizes document identifier for comparison
 */
function normalizeId(id) {
  if (!id) return '';
  return String(id).trim().toUpperCase();
}

/**
 * Checks if a date string or Date object is in the past
 */
function isDateExpired(date) {
  if (!date) return false;
  const d = new Date(date);
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}

/**
 * Analyzes retrieved chunks for procedure conflicts and supersession
 * 
 * @param {Array} retrievedChunks - Array of chunks with metadata
 * @param {string} query - The search query
 * @param {Array} allDocs - Optional list of all documents in system for supersession lookups
 * @returns {Object} Conflict analysis result
 */
export function detectConflicts(retrievedChunks = [], query = '', allDocs = []) {
  if (!retrievedChunks || retrievedChunks.length === 0) {
    return {
      hasConflict: false,
      conflictType: 'NONE',
      severity: 'LOW',
      warningMessage: null,
      recommendation: null,
      authoritativeDocument: null,
      supersededDocuments: [],
      affectedDocuments: []
    };
  }

  // Deduplicate documents present in retrieved chunks
  const docMap = new Map();
  retrievedChunks.forEach(chunk => {
    const meta = chunk.metadata || {};
    const docId = meta.documentId || meta.source;
    if (docId && !docMap.has(normalizeId(docId))) {
      docMap.set(normalizeId(docId), {
        documentId: docId,
        title: meta.documentTitle || meta.document_title || meta.title || docId,
        version: meta.version || 'Unknown',
        status: (meta.status || 'UNKNOWN').toUpperCase(),
        effectiveDate: meta.effectiveDate || meta.effective_date || null,
        expiryDate: meta.expiryDate || meta.expiry_date || null,
        supersedes: Array.isArray(meta.supersedes)
          ? meta.supersedes.map(normalizeId)
          : (typeof meta.supersedes === 'string' && meta.supersedes.trim()
              ? meta.supersedes.split(',').map(s => normalizeId(s))
              : []),
        supersededBy: meta.supersededBy ? normalizeId(meta.supersededBy) : null,
        documentType: meta.documentType || 'Manual'
      });
    }
  });

  const docs = Array.from(docMap.values());
  const supersededDocs = [];
  const expiredDocs = [];
  const draftDocs = [];
  const currentDocs = [];

  docs.forEach(doc => {
    if (doc.status === 'SUPERSEDED' || doc.supersededBy) {
      supersededDocs.push(doc);
    } else if (doc.status === 'EXPIRED' || isDateExpired(doc.expiryDate)) {
      expiredDocs.push(doc);
    } else if (doc.status === 'DRAFT') {
      draftDocs.push(doc);
    } else if (doc.status === 'CURRENT' || doc.status === 'APPROVED' || doc.status === 'ACTIVE') {
      currentDocs.push(doc);
    }
  });

  // Check if any CURRENT document explicitly supersedes another retrieved document
  let explicitSupersededDoc = null;
  let explicitAuthoritativeDoc = null;

  for (const curr of currentDocs) {
    if (curr.supersedes && curr.supersedes.length > 0) {
      for (const supersededId of curr.supersedes) {
        const match = docs.find(d => normalizeId(d.documentId) === supersededId);
        if (match) {
          explicitAuthoritativeDoc = curr;
          explicitSupersededDoc = match;
          if (!supersededDocs.some(d => normalizeId(d.documentId) === normalizeId(match.documentId))) {
            supersededDocs.push(match);
          }
          break;
        }
      }
    }
    if (explicitAuthoritativeDoc) break;
  }

  // 1. Conflict Scenario: SUPERSEDED PROCEDURE DETECTED
  if (supersededDocs.length > 0) {
    const authoritative = explicitAuthoritativeDoc || currentDocs[0] || null;
    const supersededTitles = supersededDocs.map(d => `${d.title} (${d.documentId} v${d.version})`).join(', ');
    const authoritativeTitle = authoritative ? `${authoritative.title} (${authoritative.documentId} v${authoritative.version})` : 'current published manual';

    return {
      hasConflict: true,
      conflictType: 'SUPERSEDED_PROCEDURE_DETECTED',
      severity: 'CRITICAL',
      warningMessage: `CRITICAL SAFETY WARNING: Retrieved procedures contain SUPERSEDED documentation [${supersededTitles}]. Outdated procedures must NEVER be executed.`,
      recommendation: authoritative
        ? `Adhere strictly to the current authoritative procedure in ${authoritativeTitle}, which supersedes previous versions.`
        : `Check the active document repository for the current effective replacement before taking operational action.`,
      authoritativeDocument: authoritative ? {
        documentId: authoritative.documentId,
        title: authoritative.title,
        version: authoritative.version,
        effectiveDate: authoritative.effectiveDate,
        status: authoritative.status
      } : null,
      supersededDocuments: supersededDocs.map(d => ({
        documentId: d.documentId,
        title: d.title,
        version: d.version,
        status: d.status
      })),
      affectedDocuments: docs.map(d => d.documentId)
    };
  }

  // 2. Conflict Scenario: EXPIRED PROCEDURE DETECTED
  if (expiredDocs.length > 0) {
    const expiredTitles = expiredDocs.map(d => `${d.title} (${d.documentId})`).join(', ');
    return {
      hasConflict: true,
      conflictType: 'EXPIRED_PROCEDURE_DETECTED',
      severity: 'HIGH',
      warningMessage: `EXPIRATION WARNING: Retrieved document(s) [${expiredTitles}] have passed their validity period.`,
      recommendation: `Ground staff must contact Flight Operations Dispatch to verify if an extension or updated revision has been published.`,
      authoritativeDocument: currentDocs[0] ? {
        documentId: currentDocs[0].documentId,
        title: currentDocs[0].title,
        version: currentDocs[0].version
      } : null,
      supersededDocuments: [],
      affectedDocuments: expiredDocs.map(d => d.documentId)
    };
  }

  // 3. Conflict Scenario: DRAFT PROCEDURE DETECTED
  if (draftDocs.length > 0) {
    const draftTitles = draftDocs.map(d => `${d.title} (${d.documentId})`).join(', ');
    return {
      hasConflict: true,
      conflictType: 'DRAFT_PROCEDURE_DETECTED',
      severity: 'HIGH',
      warningMessage: `DRAFT STATUS WARNING: Retrieved document(s) [${draftTitles}] are in DRAFT status and have not been formally approved.`,
      recommendation: `Operational decisions cannot be made using unapproved draft documents. Reference only approved, signed procedures.`,
      authoritativeDocument: currentDocs[0] ? {
        documentId: currentDocs[0].documentId,
        title: currentDocs[0].title,
        version: currentDocs[0].version
      } : null,
      supersededDocuments: [],
      affectedDocuments: draftDocs.map(d => d.documentId)
    };
  }

  // 4. Scenario: CONCURRENT ACTIVE PROCEDURES (Multiple current docs)
  if (currentDocs.length > 1) {
    // Check if they are of different types (e.g. Safety Bulletin vs General SOP)
    const types = new Set(currentDocs.map(d => d.documentType));
    const isMultiSource = types.size > 1;
    const titles = currentDocs.map(d => `${d.documentType}: ${d.title} (${d.documentId})`).join(' and ');

    return {
      hasConflict: false,
      conflictType: isMultiSource ? 'CONCURRENT_PROCEDURE_SUPPLEMENT' : 'MULTI_DOCUMENT_CONSENSUS',
      severity: 'INFO',
      warningMessage: isMultiSource
        ? `PROCEDURE HIERARCHY NOTICE: Multiple current documents apply (${titles}). Safety Bulletins and Regulatory Directives take operational precedence over Standard Operating Procedures.`
        : null,
      recommendation: `Review both sources to ensure full compliance with specific directives and general operating limits.`,
      authoritativeDocument: {
        documentId: currentDocs[0].documentId,
        title: currentDocs[0].title,
        version: currentDocs[0].version,
        status: currentDocs[0].status
      },
      supersededDocuments: [],
      affectedDocuments: currentDocs.map(d => d.documentId)
    };
  }

  // 5. Default: Single current document or clear alignment
  const primaryDoc = currentDocs[0] || docs[0] || null;
  return {
    hasConflict: false,
    conflictType: 'NONE',
    severity: 'LOW',
    warningMessage: null,
    recommendation: 'All cited procedures are current and authorized for operational use.',
    authoritativeDocument: primaryDoc ? {
      documentId: primaryDoc.documentId,
      title: primaryDoc.title,
      version: primaryDoc.version,
      status: primaryDoc.status
    } : null,
    supersededDocuments: [],
    affectedDocuments: docs.map(d => d.documentId)
  };
}

