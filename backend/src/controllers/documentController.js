import Document from '../models/Document.js';
import { ingestDocument } from '../rag/ingester.js';
import { deleteDocumentChunks } from '../rag/vectorStore.js';
import fs from 'fs/promises';

const toPublicDocument = document => {
  const result = document.toObject ? document.toObject() : { ...document };
  delete result.filePath;
  delete result.createdBy;
  return result;
};

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

export const getDocument = async (req, res, next) => {
  try {
    const doc = await Document.findOne({ documentId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(toPublicDocument(doc));
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
      // Remove newly uploaded file since doc exists
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Document ID already exists' });
    }

    const doc = await Document.create({
      documentId,
      title,
      documentType,
      version,
      issueDate: new Date(issueDate),
      effectiveDate: new Date(effectiveDate),
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      status: status || 'CURRENT',
      supersedes: supersedes ? supersedes.split(',').map(s => s.trim()) : [],
      filePath: req.file.path,
      fileType: req.file.originalname.endsWith('.pdf') ? 'pdf' : 'txt',
      processingStatus: 'PROCESSING',
      createdBy: req.user._id
    });

    // Update supersededBy on older docs if necessary
    if (doc.supersedes && doc.supersedes.length > 0) {
      await Document.updateMany(
        { documentId: { $in: doc.supersedes } },
        { status: 'SUPERSEDED', supersededBy: doc.documentId }
      );
    }

    // Trigger ingest asynchronously to not block request? No, let's await it.
    try {
      await ingestDocument(doc.documentId);
    } catch (error) {
      doc.processingStatus = 'FAILED';
      doc.processingError = error.message.slice(0, 500);
      await doc.save();
      throw error;
    }

    // Fetch updated doc to get chunkCount and pageCount
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
    const doc = await Document.findOneAndUpdate(
      { documentId: req.params.id },
      updates,
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });
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
    
    // Attempt to delete file
    await fs.unlink(doc.filePath).catch(() => {});
    
    await Document.deleteOne({ _id: doc._id });
    res.json({ message: 'Document removed' });
  } catch (error) {
    next(error);
  }
};
