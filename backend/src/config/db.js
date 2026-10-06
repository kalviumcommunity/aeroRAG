import mongoose from 'mongoose';
import config from './env.js';
import logger from '../utils/logger.js';

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 2000 });
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    // In demo mode or development, we might not exit if we want to run without db for testing
    // but typically a db is required for users/history/docs.
    // We will just log it. Some endpoints will fail if DB is down.
  }
};

export default connectDB;
