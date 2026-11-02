import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  documentId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  documentType: {
    type: String,
    enum: [
      'Operational Manual',
      'Safety Bulletin',
      'Regulatory Directive',
      'Standard Operating Procedure',
      'Quick Reference Handbook',
      'Maintenance Manual',
      'Flight Crew Operating Manual'
    ],
    default: 'Operational Manual',
    required: true
  },
  version: { type: String, required: true },
  issueDate: { type: Date, required: true },
  effectiveDate: { type: Date, required: true },
  expiryDate: { type: Date },
  status: {
    type: String,
    enum: ['CURRENT', 'SUPERSEDED', 'HISTORICAL', 'EXPIRED', 'DRAFT', 'UNKNOWN'],
    default: 'CURRENT'
  },
  supersedes: [{ type: String }],
  supersededBy: { type: String, default: null },
  applicableAircraft: [{ type: String }],
  notes: { type: String, default: '' },
  filePath: { type: String, required: true },
  fileType: {
    type: String,
    enum: ['pdf', 'txt', 'docx', 'html', 'htm', 'md', 'markdown'],
    required: true
  },
  pageCount: { type: Number, default: 1 },
  chunkCount: { type: Number, default: 0 },
  processingStatus: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'READY', 'FAILED'],
    default: 'PENDING'
  },
  processingError: { type: String, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// Helper to determine if a document is expired based on effective dates
documentSchema.methods.isExpired = function () {
  if (!this.expiryDate) return false;
  return new Date() > new Date(this.expiryDate);
};

/**
 * Effective lifecycle status seen by operators. A CURRENT document whose
 * expiry date has passed must never be presented as current.
 */
documentSchema.methods.effectiveStatus = function () {
  if (this.status === 'CURRENT' && this.isExpired()) {
    return 'EXPIRED';
  }
  return this.status;
};

documentSchema.methods.isCurrent = function () {
  return this.effectiveStatus() === 'CURRENT';
};

export default mongoose.model('Document', documentSchema);
