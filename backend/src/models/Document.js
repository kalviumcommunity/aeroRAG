import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  documentId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  documentType: { type: String, enum: ['Operational Manual', 'Safety Bulletin', 'Regulatory Directive'], required: true },
  version: { type: String, required: true },
  issueDate: { type: Date, required: true },
  effectiveDate: { type: Date, required: true },
  expiryDate: { type: Date },
  status: { type: String, enum: ['CURRENT', 'SUPERSEDED', 'EXPIRED', 'DRAFT'], default: 'CURRENT' },
  supersedes: [{ type: String }],
  supersededBy: { type: String },
  filePath: { type: String, required: true },
  fileType: { type: String, enum: ['pdf', 'txt'], required: true },
  pageCount: { type: Number },
  chunkCount: { type: Number, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('Document', documentSchema);
