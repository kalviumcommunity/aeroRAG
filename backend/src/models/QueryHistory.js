import mongoose from 'mongoose';

const queryHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  query: { type: String, required: true },
  answer: { type: String, required: true },
  sources: [{
    documentId: String,
    title: String,
    version: String,
    section: String,
    page: String,
    effectiveDate: Date,
    status: String
  }],
  citations: [{
    documentId: String,
    title: String,
    status: String,
    version: String,
    section: String,
    page: String,
    passage: String
  }],
  conflictAnalysis: {
    hasConflict: Boolean,
    conflictType: String,
    severity: String,
    warningMessage: String,
    recommendation: String,
    authoritativeDocument: mongoose.Schema.Types.Mixed,
    supersededDocuments: [mongoose.Schema.Types.Mixed]
  },
  retrievedChunks: { type: Number },
  confidence: { type: Number }
}, { timestamps: true });

export default mongoose.model('QueryHistory', queryHistorySchema);
