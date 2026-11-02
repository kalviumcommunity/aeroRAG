import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DEMO_MODE = 'true';
process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

test('chunker splits text into section-aware chunks within the word budget', async () => {
  const { chunkText } = await import('../src/rag/chunker.js');
  const text = [
    '### 1. STERILE COCKPIT',
    'Sterile flight deck procedures must be strictly observed below 10,000 feet MSL.',
    '',
    '### 2. CLIMB AND DESCENT',
    'Upon climbing through 10,000 feet MSL the crew states the callout.',
    '',
    'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.'
  ].join('\n\n');

  const chunks = chunkText(text, 40, 10);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.text.trim().length > 0);
    assert.ok(chunk.wordCount <= 80, `chunk exceeded budget: ${chunk.wordCount}`);
    assert.ok(typeof chunk.chunkIndex === 'number');
    assert.ok(chunk.metadata?.sectionTitle || chunk.metadata?.headings?.length > 0);
  }
});

test('Document effectiveStatus never presents an expired CURRENT document as current', async () => {
  const Document = (await import('../src/models/Document.js')).default;
  const now = new Date();

  const current = new Document({
    documentId: 'DOC-1', title: 'T', version: '1',
    issueDate: new Date(now.getFullYear() - 1, 0, 1),
    effectiveDate: new Date(now.getFullYear() - 1, 0, 1),
    status: 'CURRENT'
  });
  assert.equal(current.effectiveStatus(), 'CURRENT');

  const expired = new Document({
    documentId: 'DOC-2', title: 'T', version: '1',
    issueDate: new Date(2020, 0, 1),
    effectiveDate: new Date(2020, 0, 1),
    expiryDate: new Date(now.getFullYear() - 1, 0, 1),
    status: 'CURRENT'
  });
  assert.equal(expired.effectiveStatus(), 'EXPIRED');
  assert.equal(expired.isCurrent(), false);

  const superseded = new Document({
    documentId: 'DOC-3', title: 'T', version: '1',
    issueDate: new Date(2020, 0, 1),
    effectiveDate: new Date(2020, 0, 1),
    status: 'SUPERSEDED'
  });
  assert.equal(superseded.effectiveStatus(), 'SUPERSEDED');
  assert.equal(superseded.isExpired(), false);
});

test('retriever lexical overlap scores relevant chunks higher', async () => {
  const { lexicalOverlap } = await import('../src/rag/retriever.js');
  const high = lexicalOverlap('sterile cockpit altitude', { document: 'Sterile cockpit below 10,000 feet MSL' });
  const low = lexicalOverlap('sterile cockpit altitude', { document: 'Fuel reserve requirements for dispatch' });
  assert.ok(high > low);
  assert.equal(lexicalOverlap('', { document: 'anything' }), 0);
});

test('RAG pipeline returns grounded citations for a relevant query in demo mode', async () => {
  const { runRagPipeline } = await import('../src/rag/pipeline.js');
  const result = await runRagPipeline('sterile cockpit altitude');
  assert.equal(result.demoMode, true);
  assert.ok(result.retrievedChunks >= 1);
  assert.ok(result.sources.length >= 1);
  assert.ok(result.sources.some((source) => source.documentId === 'SOP-OPS-737-04'));
  assert.ok(result.citations.length >= 1);
  const citation = result.citations.find((c) => c.documentId === 'SOP-OPS-737-04');
  assert.ok(citation, 'expected the current sterile cockpit document to be cited');
  assert.ok(citation.title);
  assert.ok(citation.version);
  assert.ok(citation.passage);
  assert.match(citation.passage, /10,000 feet/i);
  assert.equal(result.isGrounded, true);
  assert.match(result.answer, /EXTRACTIVE ONLY/);
});

test('RAG pipeline abstains with no citation when evidence is insufficient', async () => {
  const { runRagPipeline } = await import('../src/rag/pipeline.js');
  const result = await runRagPipeline('blorbix zynkrum quxidium nonexistent flux');
  assert.equal(result.retrievedChunks, 0);
  assert.equal(result.sources.length, 0);
  assert.equal(result.citations.length, 0);
  assert.equal(result.isGrounded, false);
  assert.match(result.answer, /could not find sufficient information/i);
});
