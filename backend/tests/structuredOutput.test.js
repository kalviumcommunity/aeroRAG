import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  STRUCTURED_RAG_SCHEMA,
  STRUCTURED_SYSTEM_PROMPT,
  APPLICABILITY_STATUSES,
  UNCERTAINTY_LEVELS,
  REFUSAL_REASONS,
  DOCUMENT_STATUSES,
  parseStructuredOutput,
  validateStructuredOutput,
  processLlmOutput,
  normalizeApplicabilityStatus,
  normalizeUncertainty
} from '../src/rag/structuredOutput.js';

import {
  validateModelParameters,
  ModelParameterError,
  ModelParameterValidationError,
  UnsupportedParameterError,
  DEFAULT_GROUNDED_PARAMETERS,
  PROVIDER_CAPABILITIES
} from '../src/rag/modelParameters.js';

import { MockLLMAdapter } from '../src/rag/llmClient.js';

describe('Milestones 3.16 & 3.17: Model Output Control & Structured Response Handling', () => {

  // ==========================================================================
  // Suite 1: Model Parameter Controls & Provider Validation (Milestone 3.16)
  // ==========================================================================
  describe('Model Parameter Validation & Provider Incompatibilities', () => {
    it('should use grounded defaults when no parameters are provided', () => {
      const res = validateModelParameters({}, 'gemini');
      assert.equal(res.valid, true);
      assert.equal(res.parameters.temperature, DEFAULT_GROUNDED_PARAMETERS.temperature);
      assert.equal(res.parameters.maxOutputTokens, DEFAULT_GROUNDED_PARAMETERS.maxOutputTokens);
      assert.equal(res.parameters.topP, DEFAULT_GROUNDED_PARAMETERS.topP);
      assert.equal(res.parameters.topK, DEFAULT_GROUNDED_PARAMETERS.topK);
      assert.deepEqual(res.parameters.stopSequences, []);
    });

    it('should resolve standard parameter aliases (e.g. max_tokens -> maxOutputTokens)', () => {
      const res = validateModelParameters({ max_tokens: 300, stop: ['\nEND'] }, 'gemini');
      assert.equal(res.parameters.maxOutputTokens, 300);
      assert.deepEqual(res.parameters.stopSequences, ['\nEND']);
    });

    it('should clamp out-of-bounds parameters safely in permissive mode', () => {
      const res = validateModelParameters({
        temperature: 3.5, // max 2.0
        maxOutputTokens: 10000 // max 8192
      }, 'gemini', { clampOutOfBounds: true });

      assert.equal(res.parameters.temperature, 2.0);
      assert.equal(res.parameters.maxOutputTokens, 8192);
      assert.ok(res.warnings.length > 0);
    });

    it('should explicitly detect provider-specific unsupported parameters (e.g. presencePenalty for Gemini)', () => {
      const res = validateModelParameters({
        temperature: 0.2,
        presencePenalty: 0.5,
        frequencyPenalty: 0.5,
        logitBias: { '50256': -100 }
      }, 'gemini', { strict: false });

      assert.equal(res.valid, true);
      assert.deepEqual(res.unsupportedParameters.sort(), ['frequencyPenalty', 'logitBias', 'presencePenalty']);
      assert.ok(res.warnings.some(w => w.includes("does not support parameter 'presencePenalty'")));
      // Unsupported parameters must be excluded from sanitized generationConfig
      assert.equal(res.parameters.presencePenalty, undefined);
      assert.equal(res.parameters.frequencyPenalty, undefined);
    });

    it('should throw UnsupportedParameterError in strict mode for provider-incompatible parameters', () => {
      assert.throws(
        () => validateModelParameters({
          presencePenalty: 0.8
        }, 'gemini', { strict: true }),
        (err) => {
          assert.ok(err instanceof UnsupportedParameterError);
          assert.equal(err.parameter, 'presencePenalty');
          assert.equal(err.category, 'UNSUPPORTED_PARAMETER');
          assert.ok(err.message.includes('not supported by provider \'gemini\''));
          return true;
        }
      );
    });

    it('should throw ModelParameterValidationError in strict mode for invalid non-numeric inputs', () => {
      assert.throws(
        () => validateModelParameters({ temperature: 'invalid-string' }, 'gemini', { strict: true }),
        (err) => {
          assert.ok(err instanceof ModelParameterValidationError);
          assert.equal(err.parameter, 'temperature');
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Suite 2: Typed Response Schema & Successful Outputs (Milestone 3.17)
  // ==========================================================================
  describe('Typed Response Schema & Successful Responses', () => {
    it('should validate a complete, strongly-typed structured procedure response', () => {
      const validPayload = {
        answer: 'Sterile cockpit is mandatory below 10,000 feet MSL during critical phases of flight.',
        evidenceReferences: [
          {
            documentId: 'SOP-OPS-737-04',
            title: 'Boeing 737 Sterile Cockpit and Critical Phase Procedures',
            section: '1. Sterile Cockpit Environment',
            page: 1,
            effectiveDate: '2024-03-01',
            status: 'APPROVED',
            quote: 'The sterile cockpit rule is strictly enforced during all critical phases of flight below 10,000 feet MSL.'
          }
        ],
        applicabilityStatus: 'APPLICABLE',
        uncertainty: {
          level: 'LOW',
          score: 0.05,
          reason: 'Verbatim clause in active approved SOP'
        },
        refusalReason: null
      };

      const result = validateStructuredOutput(validPayload);

      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
      assert.equal(result.data.answer, validPayload.answer);
      assert.equal(result.data.evidenceReferences.length, 1);
      assert.equal(result.data.applicabilityStatus, 'APPLICABLE');
      assert.equal(result.data.uncertainty.level, 'LOW');
      assert.equal(result.data.uncertainty.score, 0.05);
      assert.equal(result.data.refusalReason, null);

      // Legacy compatibility verification
      assert.equal(result.data.source.documentId, 'SOP-OPS-737-04');
      assert.equal(result.data.confidence, 0.95);
      assert.equal(result.data.isGrounded, true);
    });

    it('should validate an explicit procedural refusal when evidence is absent', () => {
      const refusalPayload = {
        answer: 'I could not find sufficient information in the available airline documents.',
        evidenceReferences: [],
        applicabilityStatus: 'NOT_APPLICABLE',
        uncertainty: {
          level: 'COMPLETE',
          score: 1.0,
          reason: 'No matching documentation found'
        },
        refusalReason: 'INSUFFICIENT_EVIDENCE'
      };

      const result = validateStructuredOutput(refusalPayload);

      assert.equal(result.valid, true);
      assert.equal(result.data.refusalReason, 'INSUFFICIENT_EVIDENCE');
      assert.equal(result.data.applicabilityStatus, 'NOT_APPLICABLE');
      assert.equal(result.data.isGrounded, false);
      assert.equal(result.data.evidenceReferences.length, 0);
    });
  });

  // ==========================================================================
  // Suite 3: Malformed JSON Recovery Pipeline
  // ==========================================================================
  describe('Malformed JSON Recovery Pipeline', () => {
    it('should recover from markdown code fences (```json ... ```)', () => {
      const fenced = '```json\n{\n  "answer": "Grounded answer text",\n  "evidenceReferences": [{"documentId": "SOP-1", "title": "Doc", "status": "APPROVED"}],\n  "applicabilityStatus": "APPLICABLE",\n  "uncertainty": {"level": "LOW", "score": 0.1}\n}\n```';

      const res = processLlmOutput(fenced);
      assert.equal(res.success, true);
      assert.equal(res.stage, 'MARKDOWN_STRIP');
      assert.equal(res.recovered, true);
      assert.equal(res.data.answer, 'Grounded answer text');
    });

    it('should recover from conversational preambles and postscripts', () => {
      const conversational = 'Certainly! Here is the verified procedure JSON:\n\n{\n  "answer": "Flaps 15 limit is 205 kt",\n  "evidenceReferences": [{"documentId": "FCOM-737", "title": "B737 FCOM", "status": "APPROVED"}],\n  "applicabilityStatus": "APPLICABLE",\n  "uncertainty": {"level": "LOW", "score": 0.05}\n}\n\nLet me know if you need any additional checklists!';

      const res = processLlmOutput(conversational);
      assert.equal(res.success, true);
      assert.equal(res.stage, 'EXTRACT_BRACKETS');
      assert.equal(res.recovered, true);
      assert.equal(res.data.answer, 'Flaps 15 limit is 205 kt');
    });

    it('should repair syntax imperfections: trailing commas and unquoted keys', () => {
      const imperfect = '{\n  answer: "Oxygen masks required above FL250",\n  evidenceReferences: [\n    {\n      documentId: "SOP-OXY",\n      title: "Supplemental Oxygen",\n      status: "APPROVED",\n    },\n  ],\n  applicabilityStatus: "APPLICABLE",\n  uncertainty: { level: "LOW", score: 0.1, },\n}';

      const res = processLlmOutput(imperfect);
      assert.equal(res.success, true);
      assert.equal(res.stage, 'SYNTAX_REPAIR');
      assert.equal(res.recovered, true);
      assert.equal(res.data.answer, 'Oxygen masks required above FL250');
    });

    it('should recover essential fields heuristically from a truncated JSON stream', () => {
      const truncated = '{"answer": "Standard climb profile is 250 knots below 10,000 feet MSL.", "documentId": "SOP-CLIMB-01", "title": "B737 Normal Climb", "status": "APPROVED", "applicabilityStatus": "APPLICABLE", "confidence": 0.9'; // Cut off before closing brace

      const res = processLlmOutput(truncated);
      assert.equal(res.success, true);
      assert.equal(res.stage, 'HEURISTIC_REGEX_RECOVERY');
      assert.equal(res.recovered, true);
      assert.equal(res.data.answer, 'Standard climb profile is 250 knots below 10,000 feet MSL.');
      assert.equal(res.data.evidenceReferences[0].documentId, 'SOP-CLIMB-01');
    });

    it('should fail gracefully on completely non-JSON corrupted outputs without throwing', () => {
      const corrupted = 'ERROR 500: The model encountered an internal hallucination failure.';
      const res = processLlmOutput(corrupted);

      assert.equal(res.success, false);
      assert.equal(res.valid, false);
      assert.equal(res.stage, 'PARSE_FAILED');
      assert.equal(res.data, null);
      assert.ok(res.errors.length > 0);
    });
  });

  // ==========================================================================
  // Suite 4: Missing Fields & Anti-Fabrication Guarantees
  // ==========================================================================
  describe('Missing Fields & Anti-Fabrication Guarantees', () => {
    it('should recover missing answer from alternative keys', () => {
      const altPayload = {
        response: 'Alternate gear extension manual procedure.',
        evidenceReferences: [{ documentId: 'QRH-GEAR', title: 'Gear QRH', status: 'APPROVED' }],
        applicabilityStatus: 'APPLICABLE',
        uncertainty: { level: 'LOW', score: 0.05 }
      };

      const res = validateStructuredOutput(altPayload);
      assert.equal(res.valid, true);
      assert.equal(res.data.answer, 'Alternate gear extension manual procedure.');
      assert.ok(res.warnings.some(w => w.includes("Recovered 'answer' from alternative key")));
    });

    it('should reject output when answer is completely missing and unrecoverable', () => {
      const missingAnswer = {
        evidenceReferences: [{ documentId: 'SOP-1', title: 'Doc', status: 'APPROVED' }],
        applicabilityStatus: 'APPLICABLE',
        uncertainty: { level: 'LOW', score: 0.1 }
      };

      const res = validateStructuredOutput(missingAnswer);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes("Missing or empty required field: 'answer'")));
    });

    it('ANTI-FABRICATION: should NEVER fabricate fake evidence references when citations are absent', () => {
      const ungroundedAnswer = {
        answer: 'The aircraft may take off without flaps in emergency situations.',
        evidenceReferences: [], // No citations provided!
        applicabilityStatus: 'APPLICABLE',
        uncertainty: { level: 'HIGH', score: 0.8 }
      };

      const res = validateStructuredOutput(ungroundedAnswer);

      assert.equal(res.valid, true);
      // Evidence must remain empty, never populated with fake documents!
      assert.deepEqual(res.data.evidenceReferences, []);
      assert.equal(res.data.source, null);
      assert.equal(res.data.isGrounded, false);
      assert.ok(res.warnings.some(w => w.includes('No evidence references provided')));
    });

    it('should migrate legacy source and sources fields into evidenceReferences array', () => {
      const legacyPayload = {
        answer: 'Taxi speed limit is 20 knots.',
        source: {
          documentId: 'SOP-TAXI-02',
          title: 'Surface Operations Manual',
          status: 'APPROVED',
          effectiveDate: '2023-05-01'
        },
        confidence: 0.95
      };

      const res = validateStructuredOutput(legacyPayload);

      assert.equal(res.valid, true);
      assert.equal(res.data.evidenceReferences.length, 1);
      assert.equal(res.data.evidenceReferences[0].documentId, 'SOP-TAXI-02');
      assert.equal(res.data.evidenceReferences[0].status, 'APPROVED');
    });
  });

  // ==========================================================================
  // Suite 5: Unsupported Enum Values Normalization
  // ==========================================================================
  describe('Unsupported Enum Values Normalization', () => {
    it('should normalize non-standard applicabilityStatus values safely without crashing', () => {
      // Test known synonyms
      assert.equal(normalizeApplicabilityStatus('CURRENT').status, 'APPLICABLE');
      assert.equal(normalizeApplicabilityStatus('APPROVED').status, 'APPLICABLE');
      assert.equal(normalizeApplicabilityStatus('DEPRECATED').status, 'SUPERSEDED');
      assert.equal(normalizeApplicabilityStatus('OBSOLETE').status, 'SUPERSEDED');
      assert.equal(normalizeApplicabilityStatus('LEGACY').status, 'HISTORICAL');
      assert.equal(normalizeApplicabilityStatus('REFUSED').status, 'NOT_APPLICABLE');

      // Test completely unsupported enum value
      const unk = normalizeApplicabilityStatus('TOTALLY_BOGUS_STATUS');
      assert.equal(unk.status, 'UNKNOWN');
      assert.equal(unk.normalized, true);
    });

    it('should normalize numeric or malformed uncertainty representations safely', () => {
      // Passed as raw float
      const fromFloat = normalizeUncertainty(0.05);
      assert.equal(fromFloat.score, 0.05);
      assert.equal(fromFloat.level, 'LOW');

      // Passed as high float
      const highFloat = normalizeUncertainty(0.85);
      assert.equal(highFloat.score, 0.85);
      assert.equal(highFloat.level, 'COMPLETE');

      // Passed as object with non-standard level
      const invalidLevelObj = normalizeUncertainty({ level: 'PRETTY_SURE', score: 0.1 });
      assert.equal(invalidLevelObj.score, 0.1);
      assert.equal(invalidLevelObj.level, 'LOW');
    });

    it('should normalize unsupported refusal reasons to INSUFFICIENT_EVIDENCE', () => {
      const payload = {
        answer: 'I cannot answer this query.',
        refusalReason: 'RANDOM_USER_REJECT',
        evidenceReferences: []
      };

      const res = validateStructuredOutput(payload);
      assert.equal(res.valid, true);
      assert.equal(res.data.refusalReason, 'INSUFFICIENT_EVIDENCE');
      assert.ok(res.warnings.some(w => w.includes('Normalized unsupported refusalReason')));
    });
  });

  // ==========================================================================
  // Suite 6: MockLLMAdapter Output Control & Incompatibility Verification
  // ==========================================================================
  describe('MockLLMAdapter Provider Compatibility & Output Control', () => {
    it('should generate structured response adhering to schema when requested', async () => {
      const adapter = new MockLLMAdapter({ model: 'mock-structured' });
      const resp = await adapter.sendMessage('Check sterile cockpit limit', {
        structured: true
      });

      const parsed = JSON.parse(resp.text);
      assert.ok(parsed.answer);
      assert.ok(Array.isArray(parsed.evidenceReferences));
      assert.equal(parsed.applicabilityStatus, 'APPLICABLE');
      assert.ok(parsed.uncertainty);
    });

    it('should generate structured refusal response when simulateRefusal is set', async () => {
      const adapter = new MockLLMAdapter({ model: 'mock-refusal' });
      const resp = await adapter.sendMessage('Unknown procedure question', {
        structured: true,
        simulateRefusal: true
      });

      const parsed = JSON.parse(resp.text);
      assert.equal(parsed.refusalReason, 'INSUFFICIENT_EVIDENCE');
      assert.deepEqual(parsed.evidenceReferences, []);
      assert.equal(parsed.applicabilityStatus, 'NOT_APPLICABLE');
    });

    it('should detect provider-specific unsupported parameters when targetProvider is gemini', async () => {
      const adapter = new MockLLMAdapter({
        model: 'mock-gemini-tester',
        targetProvider: 'gemini'
      });

      // Permissive mode drops unsupported parameters and issues metadata warning
      const resPermissive = await adapter.sendMessage('Test query', {
        presencePenalty: 0.5,
        strict: false
      });
      assert.ok(resPermissive.metadata.unsupportedParameters.includes('presencePenalty'));

      // Strict mode throws UnsupportedParameterError
      await assert.rejects(
        async () => await adapter.sendMessage('Test query', {
          presencePenalty: 0.5,
          strict: true
        }),
        (err) => {
          assert.ok(err instanceof UnsupportedParameterError);
          assert.equal(err.parameter, 'presencePenalty');
          return true;
        }
      );
    });
  });
});
