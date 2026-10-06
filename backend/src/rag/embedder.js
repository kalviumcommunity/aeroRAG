import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/env.js';
import logger from '../utils/logger.js';

let genAI;
if (config.GOOGLE_API_KEY && !config.DEMO_MODE) {
  genAI = new GoogleGenerativeAI(config.GOOGLE_API_KEY);
}

function mockEmbed(text) {
  const arr = new Float32Array(768);
  for (let i = 0; i < text.length && i < 768; i++) {
    arr[i % 768] += text.charCodeAt(i) / 1000;
  }
  const mag = Math.sqrt(arr.reduce((s,v) => s + v * v, 0)) || 1;
  return Array.from(arr).map(v => v / mag);
}

export const generateEmbedding = async (text) => {
  if (config.DEMO_MODE || !genAI) {
    return mockEmbed(text);
  }
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    logger.error(`Error generating embedding: ${error.message}`);
    throw error;
  }
};
