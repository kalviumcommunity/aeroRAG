/**
 * ============================================================================
 * Milestone 3.27 & 3.29: Similarity Metrics & Embedding Quality Evaluation
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Implements benchmark evaluation, vector numerical quality checks,
 * deterministic ranking analysis, and anomaly detection.
 *
 * SAFETY INVARIANT:
 * "Report observed ranking results without claiming that similarity alone
 * establishes procedure validity or safety."
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  computeCosineSimilarity,
  rankBySimilarity,
  validateVector,
  inspectVector,
  SIMILARITY_SAFETY_DISCLAIMER,
  IncompatibleVectorSpaceError
} from './similarityValidator.js';
import { MockEmbeddingAdapter } from './embeddingAdapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_EVAL_SET_PATH = path.resolve(__dirname, '../../evaluation/similarity_evaluation_set.json');

/**
 * Loads the synthetic similarity evaluation dataset from disk.
 *
 * @param {string} [filePath] - Optional custom path.
 * @returns {Object} Evaluation dataset.
 */
export function loadSimilarityEvaluationSet(filePath = DEFAULT_EVAL_SET_PATH) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Evaluation dataset not found at path: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Evaluates embedding quality, similarity metrics, and ranking anomalies
 * against the procedural evaluation benchmark.
 *
 * @param {Object} [options] - Evaluation configuration.
 * @param {Object} [options.dataset] - In-memory dataset override.
 * @param {Object} [options.adapter] - Embedding adapter (defaults to MockEmbeddingAdapter).
 * @param {number} [options.minSeparationMargin=0.20] - Expected minimum gap between related and unrelated.
 * @param {boolean} [options.injectAnomaly=false] - For testing anomaly detection triggers.
 * @returns {Promise<Object>} Comprehensive evaluation report.
 */
export async function evaluateSimilarityQuality(options = {}) {
  const dataset = options.dataset || loadSimilarityEvaluationSet();
  const adapter = options.adapter || new MockEmbeddingAdapter({ dimensions: 768 });
  const minSeparationMargin = options.minSeparationMargin !== undefined ? options.minSeparationMargin : 0.20;

  const corpus = dataset.corpus || [];
  const queries = dataset.queries || [];

  if (corpus.length === 0 || queries.length === 0) {
    throw new Error('Evaluation dataset must contain non-empty corpus and queries');
  }

  // 1. Embed all corpus chunks
  const embeddedCorpus = [];
  for (const item of corpus) {
    const embResult = await adapter.embedQuery(item.text);
    const inspection = inspectVector(embResult.vector, { expectedDimensions: adapter.dimensions });
    
    embeddedCorpus.push({
      ...item,
      vector: embResult.vector,
      embeddingModel: embResult.model,
      embeddingDimensions: embResult.dimensions,
      inspection
    });
  }

  // 2. Perform numerical quality audit on corpus vectors
  const vectorAudit = {
    totalVectors: embeddedCorpus.length,
    validVectors: embeddedCorpus.filter(c => c.inspection.isValid).length,
    zeroVectors: embeddedCorpus.filter(c => c.inspection.isZeroVector).length,
    normalizedVectors: embeddedCorpus.filter(c => c.inspection.isNormalized).length,
    hasNonFinite: embeddedCorpus.some(c => c.inspection.hasNonFinite),
    dimensionIntegrity: embeddedCorpus.every(c => c.vector.length === adapter.dimensions)
  };

  const queryEvaluations = [];
  const anomalies = [];
  const allRelatedSimilarities = [];
  const allUnrelatedSimilarities = [];

  // 3. Evaluate each query
  for (const q of queries) {
    const queryEmb = await adapter.embedQuery(q.text);
    
    // Rank all candidates deterministically
    const ranking = rankBySimilarity(queryEmb.vector, embeddedCorpus, {
      queryMeta: {
        model: queryEmb.model,
        dimensions: queryEmb.dimensions
      },
      strictModelCheck: true,
      allowZeroVector: true
    });

    const topRanked = ranking.results[0] || null;
    const targetChunk = embeddedCorpus.find(c => c.id === q.expectedTargetChunkId);
    
    let targetSimilarity = null;
    if (targetChunk) {
      targetSimilarity = computeCosineSimilarity(queryEmb.vector, targetChunk.vector, {
        metaA: { model: queryEmb.model, dimensions: queryEmb.dimensions },
        metaB: { model: targetChunk.embeddingModel, dimensions: targetChunk.embeddingDimensions }
      });
      allRelatedSimilarities.push(targetSimilarity);
    }

    // Measure similarities against unrelated negative controls
    const unrelatedChunks = embeddedCorpus.filter(c => c.category === 'UNRELATED_TOPIC');
    const unrelatedScores = unrelatedChunks.map(uc => {
      const sim = computeCosineSimilarity(queryEmb.vector, uc.vector, {
        metaA: { model: queryEmb.model, dimensions: queryEmb.dimensions },
        metaB: { model: uc.embeddingModel, dimensions: uc.embeddingDimensions }
      });
      allUnrelatedSimilarities.push(sim);
      return { id: uc.id, similarity: sim, title: uc.metadata.documentTitle };
    });

    const maxUnrelatedScore = unrelatedScores.length > 0 ? Math.max(...unrelatedScores.map(u => u.similarity)) : 0;
    const meanUnrelatedScore = unrelatedScores.length > 0
      ? Number((unrelatedScores.reduce((acc, u) => acc + u.similarity, 0) / unrelatedScores.length).toFixed(6))
      : 0;

    const separation = targetSimilarity !== null ? Number((targetSimilarity - maxUnrelatedScore).toFixed(6)) : 0;
    const isTargetTop1 = topRanked && topRanked.id === q.expectedTargetChunkId;

    // Optional synthetic anomaly injection for testing anomaly reporter
    if (options.injectAnomaly && q.id === queries[0].id) {
      anomalies.push({
        type: 'UNEXPECTED_RANKING_INVERSION',
        severity: 'HIGH',
        queryId: q.id,
        queryText: q.text,
        expectedChunkId: q.expectedTargetChunkId,
        unexpectedChunkId: 'chunk-unrelated-synthetic-inversion',
        expectedSimilarity: targetSimilarity,
        unexpectedSimilarity: 0.985,
        delta: Number((0.985 - (targetSimilarity || 0)).toFixed(6)),
        description: 'Simulated high-priority anomaly: Unrelated topic outranked expected operational procedure.'
      });
    }

    // Anomaly Detection: Unexpected ranking inversion
    if (!isTargetTop1 && topRanked) {
      const topChunkMeta = embeddedCorpus.find(c => c.id === topRanked.id);
      const topStatus = (topChunkMeta && (topChunkMeta.status || (topChunkMeta.metadata && topChunkMeta.metadata.status))) || 'UNSPECIFIED';
      const isTopChunkUnrelated = topChunkMeta && topChunkMeta.category === 'UNRELATED_TOPIC';
      const isTopChunkSuperseded = topStatus === 'SUPERSEDED';

      if (isTopChunkUnrelated) {
        anomalies.push({
          type: 'UNEXPECTED_RANKING_INVERSION',
          severity: 'HIGH',
          queryId: q.id,
          queryText: q.text,
          expectedChunkId: q.expectedTargetChunkId,
          unexpectedChunkId: topRanked.id,
          expectedSimilarity: targetSimilarity,
          unexpectedSimilarity: topRanked.similarity,
          delta: Number((topRanked.similarity - (targetSimilarity || 0)).toFixed(6)),
          description: `Unrelated topic chunk "${topRanked.id}" ranked higher than expected procedural chunk.`
        });
      } else if (isTopChunkSuperseded) {
        anomalies.push({
          type: 'SUPERSEDED_PROCEDURE_RANKED_FIRST',
          severity: 'SAFETY_WARNING',
          queryId: q.id,
          queryText: q.text,
          expectedChunkId: q.expectedTargetChunkId,
          rankedChunkId: topRanked.id,
          similarity: topRanked.similarity,
          description: `SAFETY ALERT: Superseded checklist/procedure "${topRanked.id}" ranked #1 due to strong semantic similarity (${topRanked.similarity}). High similarity does NOT certify current operational validity.`
        });
      }
    }

    // Anomaly Detection: Low procedural similarity
    const minExpected = q.minimumExpectedSimilarity || 0.60;
    if (targetSimilarity !== null && targetSimilarity < minExpected) {
      anomalies.push({
        type: 'LOW_PROCEDURAL_SIMILARITY',
        severity: 'MEDIUM',
        queryId: q.id,
        queryText: q.text,
        chunkId: q.expectedTargetChunkId,
        similarity: targetSimilarity,
        threshold: minExpected,
        description: `Procedural chunk similarity (${targetSimilarity}) is below minimum benchmark expectation (${minExpected}).`
      });
    }

    // Anomaly Detection: High distractor similarity
    const maxAllowedUnrelated = q.maximumUnrelatedSimilarity || 0.50;
    if (maxUnrelatedScore > maxAllowedUnrelated) {
      anomalies.push({
        type: 'HIGH_DISTRACTOR_SIMILARITY',
        severity: 'MEDIUM',
        queryId: q.id,
        queryText: q.text,
        maxUnrelatedScore,
        threshold: maxAllowedUnrelated,
        description: `Unrelated distractor score (${maxUnrelatedScore}) exceeded ceiling (${maxAllowedUnrelated}).`
      });
    }

    queryEvaluations.push({
      queryId: q.id,
      queryText: q.text,
      expectedTargetChunkId: q.expectedTargetChunkId,
      topRankedChunkId: topRanked ? topRanked.id : null,
      isTargetTop1,
      targetSimilarity,
      maxUnrelatedSimilarity: maxUnrelatedScore,
      meanUnrelatedSimilarity: meanUnrelatedScore,
      separationMargin: separation,
      top5Results: ranking.results.slice(0, 5).map(r => ({
        rank: r.rank,
        id: r.id,
        similarity: r.similarity,
        status: r.status,
        isSuperseded: r.isSuperseded,
        section: (r.metadata && r.metadata.section) || ''
      }))
    });
  }

  // 4. Compute aggregate metrics
  const meanRelatedSimilarity = allRelatedSimilarities.length > 0
    ? Number((allRelatedSimilarities.reduce((a, b) => a + b, 0) / allRelatedSimilarities.length).toFixed(6))
    : 0;

  const meanUnrelatedSimilarity = allUnrelatedSimilarities.length > 0
    ? Number((allUnrelatedSimilarities.reduce((a, b) => a + b, 0) / allUnrelatedSimilarities.length).toFixed(6))
    : 0;

  const separationMargin = Number((meanRelatedSimilarity - meanUnrelatedSimilarity).toFixed(6));
  const top1Count = queryEvaluations.filter(q => q.isTargetTop1).length;
  const top1Accuracy = Number((top1Count / queries.length).toFixed(4));

  const highSeverityAnomalies = anomalies.filter(a => a.severity === 'HIGH');
  const overallStatus = (highSeverityAnomalies.length === 0 && separationMargin >= minSeparationMargin)
    ? 'PASSED'
    : 'INVESTIGATION_REQUIRED';

  return {
    evaluationDate: new Date().toISOString(),
    overallStatus,
    datasetName: dataset.name,
    datasetVersion: dataset.version,
    embeddingModel: adapter.modelName,
    embeddingDimensions: adapter.dimensions,
    safetyDisclaimer: SIMILARITY_SAFETY_DISCLAIMER,
    safetyNotice: 'Semantic similarity alone DOES NOT imply flight safety, airworthiness, or operational effectivity.',
    metrics: {
      queriesEvaluated: queries.length,
      corpusChunksEvaluated: corpus.length,
      top1Accuracy,
      top1Matches: top1Count,
      meanRelatedSimilarity,
      meanUnrelatedSimilarity,
      separationMargin,
      minSeparationMarginRequired: minSeparationMargin
    },
    vectorAudit,
    anomalies,
    queryEvaluations
  };
}

/**
 * Formats a structured similarity evaluation report into GitHub-flavored Markdown.
 *
 * @param {Object} report - Evaluation report from evaluateSimilarityQuality.
 * @returns {string} Markdown document.
 */
export function formatEvaluationReportMarkdown(report) {
  const lines = [];

  lines.push('# Similarity Metrics & Embedding Quality Evaluation Report');
  lines.push('');
  lines.push(`**Evaluation Date:** ${report.evaluationDate}`);
  lines.push(`**Status:** ${report.overallStatus === 'PASSED' ? '✅ PASSED' : '⚠️ INVESTIGATION REQUIRED'}`);
  lines.push(`**Embedding Model:** \`${report.embeddingModel}\` (${report.embeddingDimensions} dims)`);
  lines.push('');
  lines.push('> [!IMPORTANT]');
  lines.push(`> **Safety Invariant:** ${report.safetyDisclaimer}`);
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Metric | Value | Baseline / Threshold | Status |');
  lines.push('| :--- | :--- | :--- | :--- |');
  lines.push(`| **Queries Evaluated** | ${report.metrics.queriesEvaluated} | N/A | Completed |`);
  lines.push(`| **Corpus Chunks** | ${report.metrics.corpusChunksEvaluated} | N/A | Indexed |`);
  lines.push(`| **Top-1 Accuracy** | ${(report.metrics.top1Accuracy * 100).toFixed(1)}% | >= 80.0% | ${report.metrics.top1Accuracy >= 0.8 ? 'PASS' : 'INVESTIGATE'} |`);
  lines.push(`| **Mean Related Similarity** | ${report.metrics.meanRelatedSimilarity} | >= 0.650 | ${report.metrics.meanRelatedSimilarity >= 0.65 ? 'PASS' : 'WARN'} |`);
  lines.push(`| **Mean Unrelated Similarity** | ${report.metrics.meanUnrelatedSimilarity} | <= 0.400 | ${report.metrics.meanUnrelatedSimilarity <= 0.40 ? 'PASS' : 'WARN'} |`);
  lines.push(`| **Separation Margin** | +${report.metrics.separationMargin} | >= +${report.metrics.minSeparationMarginRequired} | ${report.metrics.separationMargin >= report.metrics.minSeparationMarginRequired ? 'PASS' : 'INVESTIGATE'} |`);
  lines.push('');

  lines.push('## Vector Numerical Integrity Audit');
  lines.push('');
  lines.push(`- **Total Vectors Audited:** ${report.vectorAudit.totalVectors}`);
  lines.push(`- **Valid Number Formats:** ${report.vectorAudit.validVectors} / ${report.vectorAudit.totalVectors}`);
  lines.push(`- **Zero Vectors Detected:** ${report.vectorAudit.zeroVectors}`);
  lines.push(`- **Unit-Normalized (L2 = 1.0):** ${report.vectorAudit.normalizedVectors} / ${report.vectorAudit.totalVectors}`);
  lines.push(`- **Non-Finite (NaN / Inf):** ${report.vectorAudit.hasNonFinite ? 'DETECTED' : 'None'}`);
  lines.push(`- **Dimensional Integrity:** ${report.vectorAudit.dimensionIntegrity ? 'VERIFIED' : 'FAILED'}`);
  lines.push('');

  if (report.anomalies.length > 0) {
    lines.push('## Anomalies & Observations Reported for Investigation');
    lines.push('');
    for (const a of report.anomalies) {
      const icon = a.severity === 'HIGH' ? '🚨' : (a.severity === 'SAFETY_WARNING' ? '⚠️' : 'ℹ️');
      lines.push(`### ${icon} [${a.severity}] ${a.type}`);
      lines.push(`- **Query:** "${a.queryText}" (\`${a.queryId}\`)`);
      lines.push(`- **Description:** ${a.description}`);
      if (a.expectedSimilarity !== undefined && a.unexpectedSimilarity !== undefined) {
        lines.push(`- **Expected Similarity:** ${a.expectedSimilarity} vs **Unexpected Similarity:** ${a.unexpectedSimilarity} (Delta: ${a.delta})`);
      }
      lines.push('');
    }
  } else {
    lines.push('## Anomalies & Observations');
    lines.push('');
    lines.push('No ranking inversions or distractor leakage anomalies detected.');
    lines.push('');
  }

  lines.push('## Query Ranking Breakdown');
  lines.push('');
  for (const q of report.queryEvaluations) {
    lines.push(`### Query: "${q.queryText}"`);
    lines.push(`- **Expected Target:** \`${q.expectedTargetChunkId}\` (Similarity: ${q.targetSimilarity})`);
    lines.push(`- **Top Ranked:** \`${q.topRankedChunkId}\` (${q.isTargetTop1 ? 'Match' : 'Mismatch'})`);
    lines.push(`- **Separation vs Unrelated:** +${q.separationMargin}`);
    lines.push('');
    lines.push('| Rank | Chunk ID | Similarity | Status | Section |');
    lines.push('| :--- | :--- | :--- | :--- | :--- |');
    for (const res of q.top5Results) {
      const supersededTag = res.isSuperseded ? ' [SUPERSEDED]' : '';
      lines.push(`| ${res.rank} | \`${res.id}\` | ${res.similarity} | ${res.status}${supersededTag} | ${res.section} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export default {
  loadSimilarityEvaluationSet,
  evaluateSimilarityQuality,
  formatEvaluationReportMarkdown
};
