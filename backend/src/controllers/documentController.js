import Document from '../models/Document.js';
import { ingestDocument } from '../rag/ingester.js';
import { deleteDocumentChunks } from '../rag/vectorStore.js';
import fs from 'fs/promises';

export const listDocuments = async (req, res, next) => {
  try {
    const { status, type } = req.query;
    let query = {};
    if (status) query.status = status;
    if (type) query.documentType = type;
    const docs = await Document.find(query).sort({ createdAt: -1 });
    res.json(docs);
  } catch (error) {
    next(error);
  }
};

export const getDocument = async (req, res, next) => {
  try {
    const doc = await Document.findOne({ documentId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
  } catch (error) {
    next(error);
  }
};

export const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { documentId, title, documentType, version, issueDate, effectiveDate, expiryDate, status, supersedes } = req.body;

    const existing = await Document.findOne({ documentId });
    if (existing) {
      // Remove newly uploaded file since doc exists
      await fs.unlink(req.file.path).catch(console.error);
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
    await ingestDocument(doc.documentId);

    // Fetch updated doc to get chunkCount and pageCount
    const updatedDoc = await Document.findById(doc._id);
    res.status(201).json(updatedDoc);
  } catch (error) {
    next(error);
  }
};

export const updateDocument = async (req, res, next) => {
  try {
    const doc = await Document.findOneAndUpdate(
      { documentId: req.params.id },
      req.body,
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json(doc);
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
