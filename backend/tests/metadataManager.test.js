/**
 * ============================================================================
 * Milestone 3.22: Chunk Metadata, Source Tracking & Document Versioning Tests
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENT_TYPES,
  APPLICABILITY_STATUSES,
  VERIFICATION_STATUSES,
  UNCERTAINTY_CODES,
  validateDocumentMetadata,
  formatChunkCitation,
  propagateMetadataToChunks,
  resolveDocumentRelationships
} from '../src/rag/metadataManager.js';

import { DocumentChunker, chunkText } from '../src/rag/chunker.js';

test('Milestone 3.22: Chunk Metadata, Source Tracking & Document Versioning', async (t) => {

  await t.test('Document Metadata Validation & Normalization', async (t2) => {
    await t2.test('should validate and normalize a fully populated official document', () => {
      const raw = {
        documentId: 'SOP-OPS-737-04',
        title: 'B737 Standard Operating Procedures',
        documentType: 'SOP',
        source: 'Flight Operations Directorate',
        version: 'Rev 4.0',
        publicationDate: '2024-02-15T00:00:00Z',
        effectiveDate: '2024-03-01T00:00:00Z',
        expiryDate: '2026-03-01T00:00:00Z',
        approvalStatus: 'APPROVED',
        approvedBy: 'VP Flight Operations',
        fleetApplicability: 'B737-800'
      };

      const doc = validateDocumentMetadata(raw, { currentDate: '2024-06-01' });

      assert.equal(doc.documentId, 'SOP-OPS-737-04');
      assert.equal(doc.title, 'B737 Standard Operating Procedures');
      assert.equal(doc.documentType, 'SOP');
      assert.equal(doc.source, 'Flight Operations Directorate');
      assert.equal(doc.version, 'Rev 4.0');
      assert.equal(doc.publicationDate, '2024-02-15T00:00:00.000Z');
      assert.equal(doc.effectiveDate, '2024-03-01T00:00:00.000Z');
      assert.equal(doc.expiryDate, '2026-03-01T00:00:00.000Z');
      assert.equal(doc.approvalAuthority, 'VP Flight Operations');
      assert.equal(doc.fleetApplicability, 'B737-800');
      assert.equal(doc.applicabilityStatus, 'APPLICABLE');
      assert.equal(doc.verificationStatus, 'VERIFIED_OFFICIAL');
      assert.equal(doc.uncertainties.length, 0);
      assert.equal(doc.isUncertain, false);
    });

    await t2.test('should record uncertainties for missing document ID, publication date, and effective date', () => {
      const raw = {
        title: 'Draft Training Note',
        source: 'Instructor Group'
      };

      const doc = validateDocumentMetadata(raw);

      assert.ok(doc.documentId.startsWith('DOC_UNKNOWN_'));
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.MISSING_DOCUMENT_ID));
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.MISSING_PUBLICATION_DATE));
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.MISSING_EFFECTIVE_DATE));
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.UNVERIFIED_AUTHORITY));
      assert.equal(doc.applicabilityStatus, 'UNKNOWN');
      assert.equal(doc.verificationStatus, 'UNVERIFIED');
      assert.equal(doc.isUncertain, true);
    });

    await t2.test('should identify expired documents based on expiryDate and set EXPIRED status', () => {
      const raw = {
        documentId: 'TEMPO-NOTAM-091',
        title: 'Temporary Runway Operations Directive',
        documentType: 'SAFETY_BULLETIN',
        source: 'Airport Authority',
        effectiveDate: '2024-01-01',
        expiryDate: '2024-02-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Chief Pilot'
      };

      const doc = validateDocumentMetadata(raw, { currentDate: '2024-03-01' });

      assert.equal(doc.applicabilityStatus, 'EXPIRED');
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.DOCUMENT_EXPIRED));
      assert.equal(doc.isUncertain, true);
    });

    await t2.test('should mark conditional applicability when conditions are specified', () => {
      const raw = {
        documentId: 'SOP-A320-NEO-01',
        title: 'A320neo Engine Anti-Ice Addendum',
        documentType: 'SOP',
        source: 'Engineering',
        effectiveDate: '2024-01-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Fleet Captain',
        isConditional: true,
        conditions: 'Applicable only when OAT < 3C with visible moisture'
      };

      const doc = validateDocumentMetadata(raw);
      assert.equal(doc.applicabilityStatus, 'CONDITIONAL');
      assert.equal(doc.conditions, 'Applicable only when OAT < 3C with visible moisture');
    });
  });

  await t.test('Rule 3: Anti-Fabrication Invariant (Official Validity Evidence)', async (t2) => {
    await t2.test('should NOT claim VERIFIED_OFFICIAL without verifiable approval evidence', () => {
      const unverifiedDoc = {
        documentId: 'MAN-UNOFFICIAL-01',
        title: 'Unofficial Quick Tips',
        version: '1.0',
        publicationDate: '2024-01-01',
        effectiveDate: '2024-01-01'
        // Missing approvalStatus and approvedBy
      };

      const doc = validateDocumentMetadata(unverifiedDoc);

      assert.notEqual(doc.verificationStatus, 'VERIFIED_OFFICIAL');
      assert.equal(doc.verificationStatus, 'UNVERIFIED');
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.UNVERIFIED_AUTHORITY));
      assert.equal(doc.isUncertain, true);
    });

    await t2.test('should grant VERIFIED_OFFICIAL only when explicit approval is documented', () => {
      const officialDoc = {
        documentId: 'QRH-737-REV22',
        title: '737 Quick Reference Handbook',
        version: 'Rev 22',
        source: 'Boeing Flight Ops',
        publicationDate: '2024-01-01',
        effectiveDate: '2024-01-15',
        approvalStatus: 'OFFICIAL',
        approvedBy: 'Boeing Chief Test Pilot'
      };

      const doc = validateDocumentMetadata(officialDoc);

      assert.equal(doc.verificationStatus, 'VERIFIED_OFFICIAL');
      assert.equal(doc.approvalAuthority, 'Boeing Chief Test Pilot');
      assert.equal(doc.applicabilityStatus, 'APPLICABLE');
    });
  });

  await t.test('Metadata Propagation from Document to Chunk', async (t2) => {
    await t2.test('should propagate all source tracking, version, and citation fields to chunks', () => {
      const docMeta = {
        documentId: 'SOP-OPS-737-04',
        title: 'B737 Standard Operating Procedures',
        documentType: 'SOP',
        source: 'Flight Operations',
        version: 'Rev 4',
        effectiveDate: '2024-03-01',
        publicationDate: '2024-02-15',
        approvalStatus: 'APPROVED',
        approvedBy: 'Chief Pilot'
      };

      const mockChunks = [
        {
          text: 'Both pilots must crosscheck altimeters prior to departure.',
          chunkIndex: 0,
          metadata: {
            page: 12,
            sectionTitle: 'Altimeter Setting Procedures',
            headings: ['Standard Operating Procedures', 'Pre-Flight', 'Altimeter Setting Procedures'],
            containsProcedure: true
          }
        },
        {
          text: 'Set Barometric Altimeter to local QNH.',
          chunkIndex: 1,
          metadata: {
            page: 13,
            sectionTitle: 'Altimeter Setting Procedures',
            headings: ['Standard Operating Procedures', 'Pre-Flight', 'Altimeter Setting Procedures'],
            containsProcedure: true
          }
        }
      ];

      const enriched = propagateMetadataToChunks(docMeta, mockChunks);

      assert.equal(enriched.length, 2);

      // Verify chunk 0
      const c0 = enriched[0];
      assert.equal(c0.id, 'SOP-OPS-737-04_chunk_0');
      assert.equal(c0.chunkIndex, 0);
      assert.equal(c0.metadata.documentId, 'SOP-OPS-737-04');
      assert.equal(c0.metadata.title, 'B737 Standard Operating Procedures');
      assert.equal(c0.metadata.version, 'Rev 4');
      assert.equal(c0.metadata.applicabilityStatus, 'APPLICABLE');
      assert.equal(c0.metadata.verificationStatus, 'VERIFIED_OFFICIAL');
      assert.equal(c0.metadata.page, 12);
      assert.equal(c0.metadata.sectionTitle, 'Altimeter Setting Procedures');
      assert.equal(c0.metadata.containsProcedure, true);
      assert.equal(
        c0.metadata.citation,
        'SOP-OPS-737-04 (Rev 4), Section: "Altimeter Setting Procedures", p. 12, Eff: 2024-03-01 [APPLICABLE / VERIFIED_OFFICIAL]'
      );

      // Verify chunk 1
      const c1 = enriched[1];
      assert.equal(c1.id, 'SOP-OPS-737-04_chunk_1');
      assert.equal(c1.metadata.page, 13);
      assert.equal(
        c1.metadata.citation,
        'SOP-OPS-737-04 (Rev 4), Section: "Altimeter Setting Procedures", p. 13, Eff: 2024-03-01 [APPLICABLE / VERIFIED_OFFICIAL]'
      );
    });

    await t2.test('should format citation accurately for unverified documents with missing dates', () => {
      const citation = formatChunkCitation({
        documentId: 'MEMO-UNSPECIFIED',
        version: '0.1',
        sectionTitle: 'Notice to Aircrew',
        page: 3,
        applicabilityStatus: 'UNKNOWN',
        verificationStatus: 'UNVERIFIED'
      });

      assert.equal(
        citation,
        'MEMO-UNSPECIFIED (0.1), Section: "Notice to Aircrew", p. 3 [UNKNOWN / UNVERIFIED]'
      );
    });
  });

  await t.test('Integration with Chunker API', async (t2) => {
    await t2.test('chunkText with options.documentMetadata propagates enriched metadata to chunks', () => {
      const text = '# Sterile Cockpit\n1. Below 10,000 feet, non-essential conversation is prohibited.';
      const docMetadata = {
        documentId: 'FCOM-B777-VOL1',
        title: 'B777 Flight Crew Operating Manual',
        version: 'Issue 3',
        source: 'Engineering & Flight Ops',
        effectiveDate: '2024-01-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Director of Flight Ops'
      };

      const chunks = chunkText(text, {
        documentMetadata: docMetadata,
        maxChunkSize: 300
      });

      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].id, 'FCOM-B777-VOL1_chunk_0');
      assert.equal(chunks[0].metadata.documentId, 'FCOM-B777-VOL1');
      assert.equal(chunks[0].metadata.applicabilityStatus, 'APPLICABLE');
      assert.ok(chunks[0].metadata.citation.includes('FCOM-B777-VOL1 (Issue 3)'));
    });

    await t2.test('DocumentChunker instance decorates chunks using constructor and chunk options', () => {
      const chunker = new DocumentChunker({
        strategy: 'procedure_aware',
        maxChunkSize: 250
      });

      const text = '# Engine Fire\n1. Throttle - Close.\n2. Fire Switch - Pull.';
      const chunks = chunker.chunk(text, {
        documentId: 'QRH-737-EMERG',
        version: 'Rev 10',
        effectiveDate: '2024-05-01',
        approvalStatus: 'ACTIVE',
        approvedBy: 'Flight Standards'
      });

      assert.equal(chunks.length, 1);
      assert.equal(chunks[0].metadata.documentId, 'QRH-737-EMERG');
      assert.equal(chunks[0].metadata.verificationStatus, 'VERIFIED_OFFICIAL');
      assert.ok(chunks[0].metadata.citation.includes('QRH-737-EMERG (Rev 10)'));
    });
  });

  await t.test('Explicit Supersession Resolution', async (t2) => {
    await t2.test('should mark target document SUPERSEDED when newer document explicitly supersedes it', () => {
      const docA = {
        documentId: 'SOP-DEICE-2022',
        title: 'Winter Operations De-icing Standard',
        version: '1.0',
        publicationDate: '2022-10-01',
        effectiveDate: '2022-11-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Ground Operations VP'
      };

      const docB = {
        documentId: 'SOP-DEICE-2024',
        title: 'Winter Operations De-icing Standard Rev 2',
        version: '2.0',
        publicationDate: '2024-09-01',
        effectiveDate: '2024-10-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Ground Operations VP',
        supersedes: ['SOP-DEICE-2022']
      };

      const resolved = resolveDocumentRelationships([docA, docB]);

      const updatedA = resolved.find(d => d.documentId === 'SOP-DEICE-2022');
      const updatedB = resolved.find(d => d.documentId === 'SOP-DEICE-2024');

      assert.equal(updatedA.applicabilityStatus, 'SUPERSEDED');
      assert.equal(updatedA.supersededBy, 'SOP-DEICE-2024 (2.0)');
      assert.equal(updatedB.applicabilityStatus, 'APPLICABLE');
      assert.equal(updatedB.supersededBy, null);
    });
  });

  await t.test('Version Bumps on Identical Document ID', async (t2) => {
    await t2.test('should supersede older verified version when newer verified version is provided', () => {
      const v1 = {
        documentId: 'SOP-FUEL-MGMT',
        version: '1.0',
        publicationDate: '2023-01-01',
        effectiveDate: '2023-02-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Chief Pilot'
      };

      const v2 = {
        documentId: 'SOP-FUEL-MGMT',
        version: '2.0',
        publicationDate: '2024-01-01',
        effectiveDate: '2024-02-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Chief Pilot'
      };

      const resolved = resolveDocumentRelationships([v1, v2]);

      const resolvedV1 = resolved.find(d => d.version === '1.0');
      const resolvedV2 = resolved.find(d => d.version === '2.0');

      assert.equal(resolvedV1.applicabilityStatus, 'SUPERSEDED');
      assert.equal(resolvedV1.supersededBy, 'SOP-FUEL-MGMT (2.0)');
      assert.equal(resolvedV2.applicabilityStatus, 'APPLICABLE');
      assert.ok(resolvedV2.supersedes.includes('SOP-FUEL-MGMT (1.0)'));
    });

    await t2.test('should NOT allow unverified newer version to supersede older official verified version', () => {
      const officialOlder = {
        documentId: 'SOP-CABIN-SEC',
        version: '1.0',
        effectiveDate: '2023-01-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'VP Inflight Safety'
      };

      const unverifiedNewer = {
        documentId: 'SOP-CABIN-SEC',
        version: '2.0-DRAFT',
        effectiveDate: '2024-01-01'
        // Missing approval authority
      };

      const resolved = resolveDocumentRelationships([officialOlder, unverifiedNewer]);

      const resOlder = resolved.find(d => d.version === '1.0');
      const resNewer = resolved.find(d => d.version === '2.0-DRAFT');

      assert.notEqual(resOlder.applicabilityStatus, 'SUPERSEDED');
      assert.equal(resOlder.applicabilityStatus, 'APPLICABLE');
      assert.ok(resOlder.uncertainties.includes(UNCERTAINTY_CODES.CONFLICTING_VERSION_METADATA));

      assert.equal(resNewer.verificationStatus, 'UNVERIFIED');
      assert.ok(resNewer.uncertainties.includes(UNCERTAINTY_CODES.UNVERIFIED_AUTHORITY));
    });
  });

  await t.test('Rule 1: Temporal Invariant (Later publication date ALONE does not supersede)', async (t2) => {
    await t2.test('should NOT establish supersession solely because a document has a later publication date', () => {
      // General Training Manual published in 2024 vs Fleet-Specific SOP published in 2023
      const fleetSOP = {
        documentId: 'SOP-737-STALL-RECOVERY',
        title: '737 Stall Recovery Procedure',
        documentType: 'SOP',
        fleetApplicability: 'B737',
        publicationDate: '2023-05-01',
        effectiveDate: '2023-06-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Fleet Chief Pilot'
      };

      const generalFCTM = {
        documentId: 'FCTM-STALL-GUIDANCE-2024',
        title: 'Flight Crew Training Stall Guidance',
        documentType: 'SOP',
        fleetApplicability: 'B737',
        publicationDate: '2024-08-01', // Later publication date!
        effectiveDate: '2024-09-01',
        approvalStatus: 'APPROVED',
        approvedBy: 'Training Director'
        // Does NOT contain explicit supersedes: ['SOP-737-STALL-RECOVERY']
      };

      const resolved = resolveDocumentRelationships([fleetSOP, generalFCTM]);

      const resSOP = resolved.find(d => d.documentId === 'SOP-737-STALL-RECOVERY');
      const resFCTM = resolved.find(d => d.documentId === 'FCTM-STALL-GUIDANCE-2024');

      // SAFETY CHECK: The older document must NOT be silently marked SUPERSEDED!
      assert.notEqual(resSOP.applicabilityStatus, 'SUPERSEDED');
      assert.notEqual(resSOP.supersededBy, 'FCTM-STALL-GUIDANCE-2024');

      // Both should have TEMPORAL_SUPERSEDION_DISALLOWED uncertainty and be marked CONFLICTING / UNKNOWN
      assert.ok(
        resSOP.uncertainties.some(u => u.includes(UNCERTAINTY_CODES.TEMPORAL_SUPERSEDION_DISALLOWED)),
        'resSOP must report TEMPORAL_SUPERSEDION_DISALLOWED'
      );
      assert.ok(
        resFCTM.uncertainties.some(u => u.includes(UNCERTAINTY_CODES.TEMPORAL_SUPERSEDION_DISALLOWED)),
        'resFCTM must report TEMPORAL_SUPERSEDION_DISALLOWED'
      );
      assert.equal(resSOP.verificationStatus, 'CONFLICTING');
      assert.equal(resFCTM.verificationStatus, 'CONFLICTING');
      assert.equal(resSOP.applicabilityStatus, 'UNKNOWN');
      assert.equal(resFCTM.applicabilityStatus, 'UNKNOWN');
      assert.equal(resSOP.isUncertain, true);
      assert.equal(resFCTM.isUncertain, true);
    });
  });

  await t.test('Conflicting Records & Explicit Uncertainty Visibility', async (t2) => {
    await t2.test('should preserve conflicting flag and multiple uncertainty codes without loss', () => {
      const rawConflicting = {
        documentId: 'BULLETIN-2024-CONFLICT',
        title: 'Contradictory Fuel Loading Procedure',
        isConflicting: true,
        uncertainties: ['EXTERNAL_AUDIT_PENDING']
      };

      const doc = validateDocumentMetadata(rawConflicting);

      assert.equal(doc.verificationStatus, 'CONFLICTING');
      assert.equal(doc.isUncertain, true);
      assert.ok(doc.uncertainties.includes('EXTERNAL_AUDIT_PENDING'));
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.MISSING_EFFECTIVE_DATE));
      assert.ok(doc.uncertainties.includes(UNCERTAINTY_CODES.MISSING_PUBLICATION_DATE));
    });
  });

});
