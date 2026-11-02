import Document from '../models/Document.js';
import QueryHistory from '../models/QueryHistory.js';
import { ingestDocument } from '../rag/ingester.js';
import { deleteDocumentChunks } from '../rag/vectorStore.js';
import { extractText } from '../utils/textExtractor.js';
import fs from 'fs/promises';
import path from 'path';

const toPublicDocument = document => {
  const result = document.toObject ? document.toObject() : { ...document };
  delete result.filePath;
  delete result.createdBy;
  result.effectiveStatus = result.effectiveStatus || (document.effectiveStatus ? document.effectiveStatus() : result.status);
  return result;
};

/**
 * Computes a simple unified diff representation between two texts
 */
function computeDiff(text1 = '', text2 = '') {
  const lines1 = text1.split('\n').map(l => l.trim()).filter(Boolean);
  const lines2 = text2.split('\n').map(l => l.trim()).filter(Boolean);
  const set1 = new Set(lines1);
  const set2 = new Set(lines2);

  const removed = lines1.filter(line => !set2.has(line));
  const added = lines2.filter(line => !set1.has(line));
  const common = lines1.filter(line => set2.has(line));

  return {
    removedLines: removed,
    addedLines: added,
    commonCount: common.length,
    changesCount: removed.length + added.length
  };
}

export const listDocuments = async (req, res, next) => {
  try {
    const { status, type } = req.query;
    let query = {};
    if (status) query.status = status;
    if (type) query.documentType = type;
    const docs = await Document.find(query).sort({ createdAt: -1 });
    res.json(docs.map(toPublicDocument));
  } catch (error) {
    next(error);
  }
};

export const getDocumentStats = async (req, res, next) => {
  try {
    const [
      totalDocuments,
      currentCount,
      supersededCount,
      expiredCount,
      draftCount,
      historicalCount,
      chunkAggregate,
      totalQueries,
      typeBreakdown
    ] = await Promise.all([
      Document.countDocuments(),
      Document.countDocuments({ status: 'CURRENT' }),
      Document.countDocuments({ status: 'SUPERSEDED' }),
      Document.countDocuments({ status: 'EXPIRED' }),
      Document.countDocuments({ status: 'DRAFT' }),
      Document.countDocuments({ status: 'HISTORICAL' }),
      Document.aggregate([{ $group: { _id: null, total: { $sum: '$chunkCount' } } }]),
      QueryHistory.countDocuments(),
      Document.aggregate([{ $group: { _id: '$documentType', count: { $sum: 1 } } }])
    ]);

    const totalChunks = chunkAggregate.length > 0 ? (chunkAggregate[0].total || 0) : 0;

    res.json({
      totalDocuments,
      statusBreakdown: {
        current: currentCount,
        superseded: supersededCount,
        expired: expiredCount,
        draft: draftCount,
        historical: historicalCount
      },
      totalChunks,
      totalQueries,
      typeBreakdown: typeBreakdown.map(item => ({
        type: item._id || 'Unclassified',
        count: item.count
      }))
    });
  } catch (error) {
    next(error);
  }
};

export const getDocument = async (req, res, next) => {
  try {
    const doc = await Document.findOne({ documentId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(toPublicDocument(doc));
  } catch (error) {
    next(error);
  }
};

export const getDocumentContent = async (req, res, next) => {
  try {
    const doc = await Document.findOne({ documentId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    let content = '';
    try {
      content = (await extractText(doc.filePath, doc.fileType)).text;
    } catch (err) {
      content = `[Unable to extract text: ${err.message}]`;
    }

    res.json({
      documentId: doc.documentId,
      title: doc.title,
      documentType: doc.documentType,
      version: doc.version,
      status: doc.status,
      fileType: doc.fileType,
      chunkCount: doc.chunkCount || 0,
      content,
      length: content.length
    });
  } catch (error) {
    next(error);
  }
};

export const reindexDocument = async (req, res, next) => {
  try {
    const doc = await Document.findOne({ documentId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    doc.processingStatus = 'PROCESSING';
    await doc.save();

    try {
      const chunkCount = await ingestDocument(doc.documentId);
      const updated = await Document.findById(doc._id);
      updated.processingStatus = 'READY';
      updated.processingError = '';
      await updated.save();
      res.json({
        message: `Successfully reindexed ${doc.documentId}`,
        document: toPublicDocument(updated),
        chunks: chunkCount
      });
    } catch (ingestError) {
      doc.processingStatus = 'FAILED';
      doc.processingError = ingestError.message.slice(0, 500);
      await doc.save();
      res.status(500).json({
        error: `Failed to reindex: ${ingestError.message}`,
        document: toPublicDocument(doc)
      });
    }
  } catch (error) {
    next(error);
  }
};

export const compareDocuments = async (req, res, next) => {
  try {
    const { id1, id2 } = req.params;
    const [doc1, doc2] = await Promise.all([
      Document.findOne({ documentId: id1 }),
      Document.findOne({ documentId: id2 })
    ]);

    if (!doc1 || !doc2) {
      return res.status(404).json({
        error: `One or both documents not found (Doc 1: ${doc1 ? 'Found' : 'Missing'}, Doc 2: ${doc2 ? 'Found' : 'Missing'})`
      });
    }

    // Extract text contents
    let content1 = '';
    let content2 = '';
    try {
      content1 = (await extractText(doc1.filePath, doc1.fileType)).text;
    } catch (e) {
      content1 = `[Error extracting text for ${doc1.documentId}: ${e.message}]`;
    }
    try {
      content2 = (await extractText(doc2.filePath, doc2.fileType)).text;
    } catch (e) {
      content2 = `[Error extracting text for ${doc2.documentId}: ${e.message}]`;
    }

    // Determine supersession relationship
    const doc1NormSupersedes = (doc1.supersedes || []).map(s => s.trim().toUpperCase());
    const doc2NormSupersedes = (doc2.supersedes || []).map(s => s.trim().toUpperCase());
    const id1Norm = doc1.documentId.trim().toUpperCase();
    const id2Norm = doc2.documentId.trim().toUpperCase();

    let relationship = 'CONCURRENT_VERSIONS';
    let authoritativeId = null;
    let supersededId = null;
    let relationNotes = '';

    if (doc1NormSupersedes.includes(id2Norm) || doc2.supersededBy === doc1.documentId) {
      relationship = 'DOC1_SUPERSEDES_DOC2';
      authoritativeId = doc1.documentId;
      supersededId = doc2.documentId;
      relationNotes = `${doc1.title} (${doc1.documentId} v${doc1.version}) explicitly supersedes ${doc2.title} (${doc2.documentId} v${doc2.version}).`;
    } else if (doc2NormSupersedes.includes(id1Norm) || doc1.supersededBy === doc2.documentId) {
      relationship = 'DOC2_SUPERSEDES_DOC1';
      authoritativeId = doc2.documentId;
      supersededId = doc1.documentId;
      relationNotes = `${doc2.title} (${doc2.documentId} v${doc2.version}) explicitly supersedes ${doc1.title} (${doc1.documentId} v${doc1.version}).`;
    } else if (doc1.status === 'CURRENT' && doc2.status === 'SUPERSEDED') {
      relationship = 'DOC1_CURRENT_DOC2_SUPERSEDED';
      authoritativeId = doc1.documentId;
      supersededId = doc2.documentId;
      relationNotes = `${doc1.documentId} is marked CURRENT while ${doc2.documentId} is marked SUPERSEDED.`;
    } else {
      relationNotes = `No explicit supersession link declared between ${doc1.documentId} and ${doc2.documentId}. Both are evaluated independently.`;
    }

    const diff = computeDiff(content1, content2);

    res.json({
      document1: toPublicDocument(doc1),
      document2: toPublicDocument(doc2),
      supersession: {
        relationship,
        authoritativeId,
        supersededId,
        notes: relationNotes
      },
      content1,
      content2,
      diff
    });
  } catch (error) {
    next(error);
  }
};

export const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { documentId, title, documentType, version, issueDate, effectiveDate, expiryDate, status, supersedes } = req.body ?? {};
    if (!documentId || !title || !documentType || !version || !issueDate || !effectiveDate) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Document ID, title, type, version, issue date, and effective date are required' });
    }
    if (Number.isNaN(Date.parse(issueDate)) || Number.isNaN(Date.parse(effectiveDate))
      || (expiryDate && Number.isNaN(Date.parse(expiryDate)))) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Document dates must be valid dates' });
    }

    const existing = await Document.findOne({ documentId });
    if (existing) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Document ID already exists' });
    }

    // Determine normalized file type from original extension
    const ext = path.extname(req.file.originalname).toLowerCase();
    let fileType = 'txt';
    if (ext === '.pdf') fileType = 'pdf';
    else if (ext === '.docx') fileType = 'docx';
    else if (ext === '.html' || ext === '.htm') fileType = 'html';
    else if (ext === '.md' || ext === '.markdown') fileType = 'md';

    const supersedesArray = Array.isArray(supersedes)
      ? supersedes
      : (typeof supersedes === 'string' && supersedes.trim()
          ? supersedes.split(',').map(s => s.trim()).filter(Boolean)
          : []);

    const doc = await Document.create({
      documentId: documentId.trim(),
      title: title.trim(),
      documentType,
      version: version.trim(),
      issueDate: new Date(issueDate),
      effectiveDate: new Date(effectiveDate),
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      status: status || 'CURRENT',
      supersedes: supersedesArray,
      filePath: req.file.path,
      fileType,
      processingStatus: 'PROCESSING',
      createdBy: req.user._id
    });

    // Update supersededBy on target older docs if supersedes is populated
    if (doc.supersedes && doc.supersedes.length > 0) {
      await Document.updateMany(
        { documentId: { $in: doc.supersedes } },
        { status: 'SUPERSEDED', supersededBy: doc.documentId }
      );
    }

    // Ingest the document
    try {
      await ingestDocument(doc.documentId);
    } catch (error) {
      doc.processingStatus = 'FAILED';
      doc.processingError = error.message.slice(0, 500);
      await doc.save();
      throw error;
    }

    const updatedDoc = await Document.findById(doc._id);
    updatedDoc.processingStatus = 'READY';
    updatedDoc.processingError = '';
    await updatedDoc.save();
    res.status(201).json(toPublicDocument(updatedDoc));
  } catch (error) {
    next(error);
  }
};

export const updateDocument = async (req, res, next) => {
  try {
    const allowedFields = ['title', 'documentType', 'version', 'issueDate', 'effectiveDate', 'expiryDate', 'status', 'supersedes'];
    const updates = Object.fromEntries(
      Object.entries(req.body ?? {}).filter(([field]) => allowedFields.includes(field))
    );
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable document metadata provided' });
    }

    if (updates.supersedes && typeof updates.supersedes === 'string') {
      updates.supersedes = updates.supersedes.split(',').map(s => s.trim()).filter(Boolean);
    }

    const doc = await Document.findOneAndUpdate(
      { documentId: req.params.id },
      updates,
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // If supersedes was updated, update matching documents
    if (doc.supersedes && doc.supersedes.length > 0) {
      await Document.updateMany(
        { documentId: { $in: doc.supersedes } },
        { status: 'SUPERSEDED', supersededBy: doc.documentId }
      );
    }

    res.json(toPublicDocument(doc));
  } catch (error) {
    next(error);
  }
};

export const deleteDoc = async (req, res, next) => {
  try {
    const doc = await Document.findOne({ documentId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    
    await deleteDocumentChunks(doc.documentId);
    await fs.unlink(doc.filePath).catch(() => {});
    await Document.deleteOne({ _id: doc._id });
    res.json({ message: 'Document removed successfully' });
  } catch (error) {
    next(error);
  }
};
