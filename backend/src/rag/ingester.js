import { extractText } from '../utils/textExtractor.js';
import { chunkText } from './chunker.js';
import { generateEmbedding } from './embedder.js';
import { upsertChunks, deleteDocumentChunks } from './vectorStore.js';
import Document from '../models/Document.js';
import logger from '../utils/logger.js';

export const ingestDocument = async (documentId) => {
  const doc = await Document.findOne({ documentId });
  if (!doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  // Clear existing chunks
  await deleteDocumentChunks(documentId);

  // Extract text
  const { text, pageCount } = await extractText(doc.filePath, doc.fileType);
  if (pageCount) {
    doc.pageCount = pageCount;
  }

  // Chunk
  const chunks = chunkText(text, 500, 50);
  
  if (chunks.length === 0) {
    throw new Error(`No text extracted from document ${documentId}`);
  }

  // Embed and prepare for vector store
  const ids = [];
  const embeddings = [];
  const metadatas = [];
  const chunkTexts = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = await generateEmbedding(chunk.text);
    
    ids.push(`${doc.documentId}_chunk_${chunk.chunkIndex}`);
    embeddings.push(embedding);
    chunkTexts.push(chunk.text);
    metadatas.push({
      documentId: doc.documentId,
      documentTitle: doc.title,
      documentType: doc.documentType,
      version: doc.version,
      issueDate: doc.issueDate ? doc.issueDate.toISOString() : '',
      effectiveDate: doc.effectiveDate ? doc.effectiveDate.toISOString() : '',
      expiryDate: doc.expiryDate ? doc.expiryDate.toISOString() : '',
      status: doc.status,
      supersedes: doc.supersedes ? doc.supersedes.join(',') : '',
      supersededBy: doc.supersededBy || '',
      chunkIndex: chunk.chunkIndex,
      text: chunk.text.substring(0, 500)
    });
  }

  // Store in vector DB
  await upsertChunks(chunkTexts, embeddings, metadatas, ids);

  // Update doc record
  doc.chunkCount = chunks.length;
  await doc.save();

  logger.info(`Successfully ingested document ${documentId}, chunks: ${chunks.length}`);
  return chunks.length;
};
