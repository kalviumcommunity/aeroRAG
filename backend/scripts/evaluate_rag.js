import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const testSetPath = path.resolve(scriptDirectory, '..', 'evaluation', 'rag_test_set.json');
const indexFixturePath = path.resolve(repositoryRoot, 'data', 'vector_db', 'aerorag_chunks.json');
const jsonResultsPath = path.resolve(repositoryRoot, 'docs', 'rag_evaluation_results.json');
const markdownResultsPath = path.resolve(repositoryRoot, 'docs', 'rag_evaluation_results.md');

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function includesAny(text, patterns) {
  const normalizedText = normalize(text);
  return patterns.some(pattern => normalizedText.includes(normalize(pattern)));
}

function chunkSourceId(chunk) {
  return chunk.metadata.documentId ?? chunk.metadata.source ?? null;
}

function chunkTitle(chunk) {
  return chunk.metadata.documentTitle ?? chunk.metadata.document_title ?? null;
}

function chunkContext(chunk) {
  const metadata = Object.entries(chunk.metadata)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  return `${chunk.document}\n${metadata}`;
}

function scoreCase(testCase, result, retrieved) {
  const retrievedContext = retrieved.map(chunkContext).join('\n');
  const answer = String(result.answer ?? '');

  const factScores = testCase.facts.map(fact => {
    const answerMatched = includesAny(answer, fact.answerPatterns);
    const evidenceRetrieved = includesAny(retrievedContext, fact.evidencePatterns);
    return {
      id: fact.id,
      answerMatched,
      evidenceRetrieved,
      grounded: answerMatched && evidenceRetrieved
    };
  });

  const abstained = answer.includes(testCase.expectedAnswer);
  const answerable = testCase.answerable;
  const correctness = answerable
    ? factScores.filter(fact => fact.answerMatched).length / factScores.length
    : Number(abstained);
  const answerClaimCount = factScores.filter(fact => fact.answerMatched).length;
  const groundedClaimCount = factScores.filter(fact => fact.grounded).length;
  const grounding = answerable
    ? (answerClaimCount === 0 ? 0 : groundedClaimCount / answerClaimCount)
    : Number(abstained);

  const actualCitations = (result.sources ?? []).map(source => ({
    documentId: source.documentId ?? source.source ?? null,
    title: source.title ?? source.documentTitle ?? null,
    status: source.status ?? null
  }));

  const expectedSourceIds = testCase.expectedSources;
  const citationChecks = actualCitations.map(citation => {
    const expected = citation.documentId !== null && expectedSourceIds.includes(citation.documentId);
    const retrievedSupport = retrieved.some(chunk => (
      chunkSourceId(chunk) === citation.documentId
      && (testCase.facts.length === 0
        || testCase.facts.every(fact => includesAny(chunkContext(chunk), fact.evidencePatterns)))
    ));
    return {
      documentId: citation.documentId,
      expected,
      supported: expected && retrievedSupport
    };
  });
  const truePositiveCitations = citationChecks.filter(citation => citation.supported).length;
  const citationDenominator = Math.max(actualCitations.length, expectedSourceIds.length);
  const citationAccuracy = citationDenominator === 0
    ? 1
    : truePositiveCitations / citationDenominator;

  const retrievedChunks = retrieved.map(chunk => ({
    documentId: chunkSourceId(chunk),
    title: chunkTitle(chunk),
    status: chunk.metadata.status ?? null,
    effectiveDate: chunk.metadata.effectiveDate ?? chunk.metadata.effective_date ?? null,
    section: chunk.metadata.section ?? null,
    text: chunk.document
  }));

  return {
    id: testCase.id,
    question: testCase.question,
    answerable,
    expectedAnswer: testCase.expectedAnswer,
    expectedSources: expectedSourceIds,
    answer,
    correctness,
    grounding,
    citationAccuracy,
    factScores,
    abstained,
    actualCitations,
    citationChecks,
    retrievedChunks,
    retrievedChunkCount: result.retrievedChunks
  };
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function makeSummary(results, demoMode) {
  const cases = results.cases;
  const failures = cases.filter(testCase => (
    testCase.correctness < 1
    || testCase.grounding < 1
    || testCase.citationAccuracy < 1
  ));
  const citationsExpected = cases.reduce((sum, testCase) => sum + testCase.expectedSources.length, 0);
  const citationsEmitted = cases.reduce((sum, testCase) => sum + testCase.actualCitations.length, 0);
  const citationsCorrect = cases.reduce(
    (sum, testCase) => sum + testCase.citationChecks.filter(citation => citation.supported).length,
    0
  );

  return {
    testCaseCount: cases.length,
    correctness: average(cases.map(testCase => testCase.correctness)),
    grounding: average(cases.map(testCase => testCase.grounding)),
    citationAccuracy: average(cases.map(testCase => testCase.citationAccuracy)),
    citationPrecision: citationsEmitted === 0 ? 1 : citationsCorrect / citationsEmitted,
    citationRecall: citationsExpected === 0 ? 1 : citationsCorrect / citationsExpected,
    citationsExpected,
    citationsEmitted,
    citationsCorrect,
    failureCount: failures.length,
    demoMode,
    notableFailures: [
      ...(demoMode
        ? ['Evaluation ran in DEMO_MODE; answers are produced by the deterministic mock generator, not a live language model.']
        : []),
      ...failures.map(testCase => {
        if (!testCase.answerable && !testCase.abstained) {
          return `${testCase.id}: the system did not abstain although the indexed context contains no answer.`;
        }
        if (testCase.actualCitations.some(citation => citation.documentId === null)) {
          return `${testCase.id}: emitted source metadata has no documentId, so citation identity cannot be verified.`;
        }
        if (testCase.correctness < 1) {
          return `${testCase.id}: generated answer omitted one or more expected facts.`;
        }
        return `${testCase.id}: one or more expected citations or grounding checks failed.`;
      })
    ]
  };
}

function markdownReport(results) {
  const { summary } = results;
  const rows = results.cases.map(testCase => (
    `| ${testCase.id} | ${testCase.answerable ? 'Yes' : 'No'} | ${asPercent(testCase.correctness)} | ${asPercent(testCase.grounding)} | ${asPercent(testCase.citationAccuracy)} | ${testCase.retrievedChunkCount} |`
  ));
  const failures = summary.notableFailures.map(failure => `- ${failure}`).join('\n');
  const details = results.cases.map(testCase => {
    const citations = testCase.actualCitations.length
      ? testCase.actualCitations.map(citation => citation.documentId ?? '(missing documentId)').join(', ')
      : '(none)';
    return [
      `### ${testCase.id}`,
      '',
      `- **Question:** ${testCase.question}`,
      `- **Expected answer:** ${testCase.expectedAnswer}`,
      `- **System answer:** ${testCase.answer.replace(/\n/g, ' ')}`,
      `- **Expected sources:** ${testCase.expectedSources.join(', ') || '(none)'}`,
      `- **Emitted citations:** ${citations}`,
      `- **Fact checks:** ${testCase.factScores.map(fact => `${fact.id}: answer ${fact.answerMatched ? 'matched' : 'missing'}, evidence ${fact.evidenceRetrieved ? 'retrieved' : 'missing'}`).join('; ') || '(abstention case)'}`,
      ''
    ].join('\n');
  }).join('\n');

  return [
    '# AeroRAG evaluation results',
    '',
    `- **Run time:** ${results.generatedAt}`,
    `- **Mode:** ${summary.demoMode ? 'DEMO_MODE (offline mock generation)' : 'live model'}`,
    `- **Dataset:** ${results.datasetName} (${summary.testCaseCount} cases)`,
    `- **Indexed context:** ${results.indexedChunkCount} fixture chunk(s)`,
    '',
    '## Overall scores',
    '',
    '| Correctness | Grounding | Citation accuracy | Citation precision | Citation recall |',
    '|---:|---:|---:|---:|---:|',
    `| ${asPercent(summary.correctness)} | ${asPercent(summary.grounding)} | ${asPercent(summary.citationAccuracy)} | ${asPercent(summary.citationPrecision)} | ${asPercent(summary.citationRecall)} |`,
    '',
    'Scores are means of per-case correctness, grounding, and citation accuracy. Correctness measures expected-fact coverage (or successful abstention). Grounding measures whether matched expected claims have supporting retrieved evidence. A citation is accurate only if its document ID is expected and the retrieved chunk supports the case evidence. These are deterministic lexical checks, not a substitute for expert review.',
    '',
    '## Case results',
    '',
    '| Case | Answerable | Correctness | Grounding | Citation accuracy | Retrieved chunks |',
    '|---|:---:|---:|---:|---:|---:|',
    ...rows,
    '',
    '## Notable failures and likely causes',
    '',
    failures || '- No failures detected.',
    '',
    'The checked-in vector-store fixture contains only one short sterile-cockpit chunk. It does not contain the exact challenge callout or fuel-reserve information, so those cases should abstain. Source metadata in this fixture uses `source` and `document_title`, while the pipeline source mapping reads `documentId` and `documentTitle`; this can cause the emitted citation to lose its document ID/title. Demo answers are generic and are not suitable evidence of live-model quality.',
    '',
    '## Per-case details',
    '',
    details,
    '## Reproduction',
    '',
    'From the repository root, run `npm --prefix backend run evaluate:rag`. The runner forces `DEMO_MODE=true`, uses the checked-in local vector store, and rewrites this report and `rag_evaluation_results.json`.',
    ''
  ].join('\n');
}

async function main() {
  process.chdir(repositoryRoot);
  process.env.DEMO_MODE = 'true';
  process.env.COLLECTION_NAME = 'aerorag_chunks';
  process.env.VECTOR_DIMENSION = '768';
  const testSet = JSON.parse(await fs.readFile(testSetPath, 'utf8'));
  if (!Array.isArray(testSet.cases) || testSet.cases.length === 0) {
    throw new Error(`Evaluation test set has no cases: ${testSetPath}`);
  }
  for (const testCase of testSet.cases) {
    if (!testCase.id || !Array.isArray(testCase.expectedSources) || !Array.isArray(testCase.facts)) {
      throw new Error(`Evaluation case is missing required fields: ${testCase.id ?? '(no id)'}`);
    }
    if (testCase.answerable && testCase.facts.length === 0) {
      throw new Error(`Answerable evaluation case must define expected facts: ${testCase.id}`);
    }
  }
  const indexedFixture = JSON.parse(await fs.readFile(indexFixturePath, 'utf8'));
  if (!Array.isArray(indexedFixture)) {
    throw new Error(`Vector-store fixture must be a JSON array: ${indexFixturePath}`);
  }

  const [{ runRagPipeline }, { retrieve }] = await Promise.all([
    import('../src/rag/pipeline.js'),
    import('../src/rag/retriever.js')
  ]);
  const cases = [];
  for (const testCase of testSet.cases) {
    const retrieved = await retrieve(testCase.question, 5);
    const result = await runRagPipeline(testCase.question);
    cases.push(scoreCase(testCase, result, retrieved));
  }

  const results = {
    generatedAt: new Date().toISOString(),
    datasetName: testSet.name,
    datasetDescription: testSet.description,
    indexedChunkCount: indexedFixture.length,
    summary: {},
    cases
  };
  results.summary = makeSummary(results, process.env.DEMO_MODE === 'true');
  await fs.writeFile(jsonResultsPath, `${JSON.stringify(results, null, 2)}\n`);
  await fs.writeFile(markdownResultsPath, markdownReport(results));

  console.log(`Evaluated ${cases.length} cases against ${results.indexedChunkCount} indexed chunk(s).`);
  console.log(`Correctness: ${asPercent(results.summary.correctness)}`);
  console.log(`Grounding: ${asPercent(results.summary.grounding)}`);
  console.log(`Citation accuracy: ${asPercent(results.summary.citationAccuracy)}`);
  console.log(`Results: ${path.relative(repositoryRoot, jsonResultsPath)}`);
}

main().catch(error => {
  console.error(`RAG evaluation failed: ${error.message}`);
  process.exitCode = 1;
});
