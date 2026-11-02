/**
 * ============================================================================
 * Milestone 3.25 & 3.26: Embedding Service Facade
 * Airline Procedure Intelligence System
 * ============================================================================
 */

import {
  createEmbeddingAdapter,
  BaseEmbeddingAdapter,
  MockEmbeddingAdapter,
  GeminiEmbeddingAdapter,
  validateEmbeddingVector,
  normalizeVector,
  isCompatibleVectorSpace,
  cosineSimilarity,
  EmbeddingError,
  MissingEmbeddingConfigurationError,
  EmbeddingTimeoutError,
  EmbeddingRateLimitError,
  EmbeddingDimensionMismatchError,
  EmbeddingInvalidResponseError,
  IncompatibleVectorSpaceError,
  EmbeddingProviderError
} from './embeddingAdapter.js';

export {
  createEmbeddingAdapter,
  BaseEmbeddingAdapter,
  MockEmbeddingAdapter,
  GeminiEmbeddingAdapter,
  validateEmbeddingVector,
  normalizeVector,
  isCompatibleVectorSpace,
  cosineSimilarity,
  EmbeddingError,
  MissingEmbeddingConfigurationError,
  EmbeddingTimeoutError,
  EmbeddingRateLimitError,
  EmbeddingDimensionMismatchError,
  EmbeddingInvalidResponseError,
  IncompatibleVectorSpaceError,
  EmbeddingProviderError
};

let defaultAdapter = null;

function getDefaultAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = createEmbeddingAdapter();
  }
  return defaultAdapter;
}

/**
 * Backward-compatible embedding generation function.
 *
 * @param {string} text - Input text to embed.
 * @param {Object} [options] - Optional overrides.
 * @returns {Promise<Array<number>>} Dense embedding vector values.
 */
export const generateEmbedding = async (text, options = {}) => {
  const adapter = options.adapter || getDefaultAdapter();
  const res = await adapter.embedQuery(text);
  return res.vector;
};

/**
 * Generates an embedding record containing both the dense vector and model metadata.
 *
 * @param {string} text - Input text.
 * @param {Object} [options] - Optional overrides.
 * @returns {Promise<Object>} Full embedding DTO with model metadata.
 */
export const generateEmbeddingRecord = async (text, options = {}) => {
  const adapter = options.adapter || getDefaultAdapter();
  return await adapter.embedQuery(text);
};

export default {
  generateEmbedding,
  generateEmbeddingRecord,
  createEmbeddingAdapter
};
