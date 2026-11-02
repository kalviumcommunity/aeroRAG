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

  doc.processingStatus = 'PROCESSING';
  doc.processingError = '';
  await doc.save();

  try {
    // 1. Clear existing chunks from vector store
    await deleteDocumentChunks(documentId);

    // 2. Extract plain text across supported formats (PDF, TXT, DOCX, HTML, MD)
    const { text, pageCount } = await extractText(doc.filePath, doc.fileType);
    if (pageCount) {
      doc.pageCount = pageCount;
    }

    // 3. Chunk text into semantically coherent passages with section tracking
    const chunks = chunkText(text, 250, 35);
    if (chunks.length === 0) {
      throw new Error(`No text content could be extracted from document ${documentId}`);
    }

    // 4. Generate embeddings and prepare vector records
    const ids = [];
    const embeddings = [];
    const metadatas = [];
    const chunkTexts = [];

    const totalPages = doc.pageCount || 1;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await generateEmbedding(chunk.text);

      // Estimate page number for citations
      const estimatedPage = Math.min(
        totalPages,
        Math.max(1, Math.ceil(((i + 1) / chunks.length) * totalPages))
      );

      ids.push(`${doc.documentId}_chunk_${chunk.chunkIndex}`);
      embeddings.push(embedding);
      chunkTexts.push(chunk.text);

      metadatas.push({
        documentId: doc.documentId,
        source: doc.documentId,
        documentTitle: doc.title,
        documentType: doc.documentType,
        version: doc.version,
        issueDate: doc.issueDate ? doc.issueDate.toISOString() : '',
        effectiveDate: doc.effectiveDate ? doc.effectiveDate.toISOString() : '',
        expiryDate: doc.expiryDate ? doc.expiryDate.toISOString() : '',
        status: doc.status,
        supersedes: Array.isArray(doc.supersedes) ? doc.supersedes.join(',') : (doc.supersedes || ''),
        supersededBy: doc.supersededBy || '',
        chunkIndex: chunk.chunkIndex,
        section: chunk.section || 'General Procedure',
        page: estimatedPage,
        text: chunk.text.substring(0, 500)
      });
    }

    // 5. Store in vector database
    await upsertChunks(chunkTexts, embeddings, metadatas, ids);

    // 6. Update document status to READY
    doc.chunkCount = chunks.length;
    doc.processingStatus = 'READY';
    doc.processingError = '';
    await doc.save();

    logger.info(`Successfully ingested document ${documentId}: ${chunks.length} chunks indexed across ${totalPages} page(s).`);
    return chunks.length;
  } catch (error) {
    doc.processingStatus = 'FAILED';
    doc.processingError = (error.message || 'Unknown processing error').slice(0, 500);
    await doc.save().catch(() => {});
    logger.error(`Document ingestion failed for ${documentId}: ${error.message}`);
    throw error;
  }
};
