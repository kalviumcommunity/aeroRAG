/**
 * ============================================================================
 * Milestone 3.25, 3.26 & 3.28: Embedding Service & Batch Resilience Facade
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

import {
  BatchEmbeddingManager,
  createBatchEmbeddingManager,
  isRetryableEmbeddingError,
  calculateBackoffWithJitter,
  computeEmbeddingCacheKey,
  EmbeddingAuthenticationError,
  BatchEmbeddingExhaustedRetriesError
} from './batchEmbeddingManager.js';

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
  EmbeddingProviderError,
  BatchEmbeddingManager,
  createBatchEmbeddingManager,
  isRetryableEmbeddingError,
  calculateBackoffWithJitter,
  computeEmbeddingCacheKey,
  EmbeddingAuthenticationError,
  BatchEmbeddingExhaustedRetriesError
};

let defaultAdapter = null;
let defaultBatchManager = null;

function getDefaultAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = createEmbeddingAdapter();
  }
  return defaultAdapter;
}

export function getDefaultBatchManager() {
  if (!defaultBatchManager) {
    defaultBatchManager = createBatchEmbeddingManager({ adapter: getDefaultAdapter() });
  }
  return defaultBatchManager;
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
  createEmbeddingAdapter,
  createBatchEmbeddingManager,
  BatchEmbeddingManager
};
