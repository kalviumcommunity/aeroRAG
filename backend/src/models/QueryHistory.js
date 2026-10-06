import mongoose from 'mongoose';

const queryHistorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  query: { type: String, required: true },
  answer: { type: String, required: true },
  sources: [{
    documentId: String,
    title: String,
    section: String,
    page: String,
    effectiveDate: Date,
    status: String
  }],
  retrievedChunks: { type: Number },
}, { timestamps: true });

export default mongoose.model('QueryHistory', queryHistorySchema);
