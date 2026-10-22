import path from 'path';
import { fileURLToPath } from 'url';
import { loadCorpus, loadDocument } from '../src/rag/documentLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const corpusDir = path.resolve(__dirname, '../../data/sample_corpus');

  console.log('================================================================');
  console.log('   AERORAG: NODE.JS DOCUMENT LOADER & MULTI-FORMAT INTAKE      ');
  console.log('================================================================');
  console.log(`Corpus Directory: ${corpusDir}\n`);

  // Run directory batch intake
  const result = await loadCorpus(corpusDir);

  // Demonstrate missing file handling
  const missingPath = path.join(corpusDir, 'non_existent_procedure.pdf');
  const missingResult = await loadDocument(missingPath);
  console.log(`SKIP ${missingResult.source}: ${missingResult.error}`);

  console.log('\n================================================================');
  console.log(`INTAKE COMPLETE: ${result.stats.loadedCount} loaded, ${result.stats.skippedCount + 1} skipped.`);
  console.log('================================================================');
}

main().catch(err => {
  console.error('Fatal loader error:', err);
  process.exit(1);
});
