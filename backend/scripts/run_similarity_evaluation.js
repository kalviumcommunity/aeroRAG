/**
 * Runner script for Milestone 3.27 & 3.29: Similarity Metrics & Embedding Quality Evaluation.
 *
 * Runs synthetic procedural benchmark evaluation, validates vector numerical integrity,
 * verifies ranking separation, checks for anomalies, and writes results to docs/.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  evaluateSimilarityQuality,
  formatEvaluationReportMarkdown
} from '../src/rag/similarityQualityEvaluator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('='.repeat(70));
  console.log('Running Milestone 3.27 & 3.29 Similarity Quality Benchmark Evaluation');
  console.log('='.repeat(70));

  const report = await evaluateSimilarityQuality({
    minSeparationMargin: 0.20
  });

  console.log(`\nEvaluation Date: ${report.evaluationDate}`);
  console.log(`Status: ${report.overallStatus === 'PASSED' ? 'PASSED (Clean)' : 'INVESTIGATION REQUIRED'}`);
  console.log(`Embedding Model: ${report.embeddingModel} (${report.embeddingDimensions} dimensions)`);
  console.log(`Queries Evaluated: ${report.metrics.queriesEvaluated}`);
  console.log(`Corpus Chunks Evaluated: ${report.metrics.corpusChunksEvaluated}`);
  console.log(`Top-1 Accuracy: ${(report.metrics.top1Accuracy * 100).toFixed(1)}%`);
  console.log(`Mean Related Similarity: ${report.metrics.meanRelatedSimilarity}`);
  console.log(`Mean Unrelated Similarity: ${report.metrics.meanUnrelatedSimilarity}`);
  console.log(`Separation Margin: +${report.metrics.separationMargin} (Threshold: >= +${report.metrics.minSeparationMarginRequired})`);
  console.log(`Anomalies Reported: ${report.anomalies.length}`);

  if (report.anomalies.length > 0) {
    console.log('\nAnomalies & Investigations:');
    report.anomalies.forEach((a, i) => {
      console.log(`  [${i + 1}] [${a.severity}] ${a.type}: ${a.description}`);
    });
  }

  // Write results to docs
  const docsDir = path.resolve(__dirname, '../../docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const jsonPath = path.join(docsDir, 'similarity_quality_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nWrote JSON report to: ${jsonPath}`);

  const markdownContent = formatEvaluationReportMarkdown(report);
  const mdPath = path.join(docsDir, 'similarity_quality_results.md');
  fs.writeFileSync(mdPath, markdownContent, 'utf8');
  console.log(`Wrote Markdown report to: ${mdPath}`);

  console.log('\n' + '='.repeat(70));
  console.log('Benchmark evaluation completed successfully.');
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Evaluation run failed:', err);
  process.exit(1);
});
