import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChromaVectorCollection } from '../src/rag/chromaCollection.js';

process.env.DEMO_MODE = 'true';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

const [{ default: app }, { runRagPipeline }] = await Promise.all([
  import('../src/app.js'),
  import('../src/rag/pipeline.js')
]);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test('liveness endpoint does not require external services', async () => {
  const response = await fetch(`${baseUrl}/api/health/live`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
});

test('local frontend origin is permitted for development CORS', async () => {
  const response = await fetch(`${baseUrl}/api/health/live`, {
    headers: { Origin: 'http://127.0.0.1:5173' }
  });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
});

test('readiness reports an unavailable MongoDB instead of claiming ready', async () => {
  const response = await fetch(`${baseUrl}/api/health/ready`);
  const body = await response.json();
  assert.ok([200, 503].includes(response.status));
  if (response.status === 503) {
    assert.equal(body.status, 'not_ready');
    assert.equal(body.mongodb, 'disconnected');
  }
});

test('unknown API routes return a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-route`);
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /Route not found/);
});

test('public registration rejects invalid fields before touching the database', async () => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'A', email: 'not-an-email', password: 'short', role: 'admin' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Name must be/);
});

test('protected search rejects requests without an authentication token', async () => {
  const response = await fetch(`${baseUrl}/api/rag/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'sterile cockpit altitude' })
  });
  assert.equal(response.status, 401);
});

test('demo retrieval returns source-linked evidence for a relevant question', async () => {
  const result = await runRagPipeline('sterile cockpit altitude');
  assert.ok(result.retrievedChunks >= 1);
  assert.ok(result.sources.some((source) => source.documentId === 'SOP-OPS-737-04'));
  assert.ok(result.citations.some((citation) => citation.documentId === 'SOP-OPS-737-04' && /below 10,000 feet MSL/.test(citation.passage)));
  assert.equal(result.isGrounded, true);
  assert.match(result.answer, /EXTRACTIVE ONLY/);
});

test('demo retrieval abstains when no local evidence matches', async () => {
  const result = await runRagPipeline('blorbix zynkrum quxidium nonexistent flux');
  assert.equal(result.retrievedChunks, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.citations.length, 0);
  assert.equal(result.isGrounded, false);
  assert.match(result.answer, /could not find sufficient information/i);
});

test('Chroma adapter preserves IDs and metadata through upsert, query, and delete', async () => {
  const calls = [];
  const fakeCollection = {
    async upsert(payload) { calls.push(['upsert', payload]); },
    async get(options) {
      calls.push(['get', options]);
      return {
        ids: ['SOP-1:0'],
        embeddings: [[0.1, 0.2]],
        documents: ['Evidence passage'],
        metadatas: [{ source: 'SOP-1', chunk_index: 0 }]
      };
    },
    async query(options) {
      calls.push(['query', options]);
      return {
        ids: [['SOP-1:0']],
        distances: [[0.1]],
        documents: [['Evidence passage']],
        metadatas: [[{ source: 'SOP-1', chunk_index: 0 }]]
      };
    },
    async delete(options) { calls.push(['delete', options]); }
  };
  const collection = new ChromaVectorCollection(fakeCollection, 2);
  const record = {
    id: 'SOP-1:0',
    vector: [0.1, 0.2],
    text: 'Evidence passage',
    metadata: { source: 'SOP-1', chunk_index: 0 }
  };

  assert.deepEqual(await collection.upsert([record]), { upsertedCount: 1 });
  assert.equal((await collection.get(record.id)).id, record.id);
  const [hit] = await collection.query(record.vector, 1);
  assert.equal(hit.score, 0.9);
  assert.equal(hit.metadata.source, 'SOP-1');
  assert.equal(await collection.deleteDocumentChunks('SOP-1'), 1);
  assert.deepEqual(calls.at(-1), ['delete', { ids: ['SOP-1:0'] }]);
  await assert.rejects(() => collection.query([1], 1), /dimension mismatch/);
});

test('textExtractor correctly parses HTML content by stripping tags and decoding entities', async () => {
  const { extractText } = await import('../src/utils/textExtractor.js');
  const testHtmlPath = path.resolve('data/sample_corpus/OPS-BUL-2024-08.html');
  const extracted = await extractText(testHtmlPath, 'html');
  assert.ok(extracted.text.length > 50);
  assert.ok(!extracted.text.includes('<script'));
  assert.ok(!extracted.text.includes('<style'));
  assert.ok(!extracted.text.includes('<html>'));
  assert.match(extracted.text, /Severe Turbulence Penetration/i);
  assert.match(extracted.text, /280 KIAS/i);
});

test('conflictDetector identifies superseded procedures and authoritative successor', async () => {
  const { detectConflicts } = await import('../src/rag/conflictDetector.js');
  const mockChunks = [
    {
      document: 'Sterile cockpit below 10,000 feet MSL',
      metadata: {
        documentId: 'SOP-OPS-737-04',
        title: 'Boeing 737 Sterile Cockpit Procedures (Rev 4.0)',
        status: 'CURRENT',
        version: '4.0',
        supersedes: ['SOP-OPS-737-03']
      }
    },
    {
      document: 'Sterile cockpit below 8,000 feet MSL',
      metadata: {
        documentId: 'SOP-OPS-737-03',
        title: 'Boeing 737 Sterile Cockpit Procedures (Rev 3.0)',
        status: 'SUPERSEDED',
        version: '3.0'
      }
    }
  ];

  const analysis = detectConflicts(mockChunks, 'sterile cockpit altitude');
  assert.equal(analysis.hasConflict, true);
  assert.equal(analysis.conflictType, 'SUPERSEDED_PROCEDURE_DETECTED');
  assert.equal(analysis.severity, 'CRITICAL');
  assert.equal(analysis.authoritativeDocument.documentId, 'SOP-OPS-737-04');
  assert.equal(analysis.supersededDocuments[0].documentId, 'SOP-OPS-737-03');
  assert.match(analysis.warningMessage, /CRITICAL SAFETY WARNING/);
});

test('conflictDetector flags expired procedures with appropriate alert', async () => {
  const { detectConflicts } = await import('../src/rag/conflictDetector.js');
  const mockChunks = [
    {
      document: 'Holdover times for Type I fluid',
      metadata: {
        documentId: 'SOP-WINTER-OPS-2022',
        title: 'Winter Ground De-Icing Holdover Guidelines',
        status: 'EXPIRED',
        expiryDate: '2023-04-30'
      }
    }
  ];

  const analysis = detectConflicts(mockChunks, 'de-icing holdover times');
  assert.equal(analysis.hasConflict, true);
  assert.equal(analysis.conflictType, 'EXPIRED_PROCEDURE_DETECTED');
  assert.equal(analysis.severity, 'HIGH');
  assert.match(analysis.warningMessage, /EXPIRATION WARNING/);
});

test('conflictDetector flags draft procedures with unapproved warning', async () => {
  const { detectConflicts } = await import('../src/rag/conflictDetector.js');
  const mockChunks = [
    {
      document: 'Proposed alternate approach checklist',
      metadata: {
        documentId: 'DRAFT-APPR-09',
        title: 'RNAV Visual Approach Protocol',
        status: 'DRAFT'
      }
    }
  ];

  const analysis = detectConflicts(mockChunks, 'RNAV approach');
  assert.equal(analysis.hasConflict, true);
  assert.equal(analysis.conflictType, 'DRAFT_PROCEDURE_DETECTED');
  assert.match(analysis.warningMessage, /DRAFT STATUS WARNING/);
});

test('structured output parser recovers from markdown fences and malformed trailing commas', async () => {
  const { parseStructuredOutput, validateStructuredOutput } = await import('../src/rag/structuredOutput.js');
  const rawInput = '```json\n{\n  "answer": "Maintain 280 KIAS or 0.76 Mach in turbulence.",\n  "source": {\n    "documentId": "OPS-BUL-2024-08",\n    "title": "Severe Turbulence Safety Directive",\n    "status": "APPROVED"\n  },\n  "confidence": 0.95,\n}\n```';
  
  const parsed = parseStructuredOutput(rawInput);
  assert.equal(parsed.success, true);
  assert.match(parsed.data.answer, /280 KIAS/);
  assert.equal(parsed.data.source.documentId, 'OPS-BUL-2024-08');

  const validated = validateStructuredOutput(parsed.data);
  assert.equal(validated.valid, true);
});
