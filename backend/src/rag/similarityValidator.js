/**
 * ============================================================================
 * Milestone 3.27 & 3.29: Similarity Metrics, Vector Quality Checks & Deterministic Ranking
 * Airline Procedure Intelligence System
 * ============================================================================
 *
 * Core mathematical and algorithmic subsystem providing:
 *  1. Rigorous vector inspection & validation (dimensions, NaN, Infinity, zero vectors).
 *  2. Cosine similarity with vector space compatibility enforcement.
 *  3. Deterministic candidate ranking with stable tie-breaking.
 *  4. Safety Invariant: Similarity scores measure lexical/embedding vector proximity only.
 *     Similarity alone DOES NOT establish operational validity, regulatory compliance,
 *     aircraft effectivity, or flight crew safety approval.
 */

import {
  EmbeddingError,
  IncompatibleVectorSpaceError,
  isCompatibleVectorSpace
} from './embeddingAdapter.js';

// ============================================================================
// Custom Error Classes
// ============================================================================

export class SimilarityError extends EmbeddingError {
  constructor(message, options = {}) {
    super(message, {
      category: 'SIMILARITY_ERROR',
      statusCode: 400,
      retryable: false,
      ...options
    });
  }
}

export class InvalidVectorError extends SimilarityError {
  constructor(message, options = {}) {
    super(message, {
      category: 'INVALID_VECTOR',
      statusCode: 400,
      ...options
    });
  }
}

export class VectorDimensionMismatchError extends SimilarityError {
  constructor(expected, actual, options = {}) {
    super(`Vector dimension mismatch: expected ${expected}, got ${actual}`, {
      category: 'DIMENSION_MISMATCH',
      statusCode: 400,
      details: { expected, actual, ...options.details },
      ...options
    });
    this.expected = expected;
    this.actual = actual;
  }
}

export class ZeroVectorError extends SimilarityError {
  constructor(message = 'Zero vector encountered: magnitude (L2 norm) is 0', options = {}) {
    super(message, {
      category: 'ZERO_VECTOR',
      statusCode: 400,
      details: options.details || null,
      ...options
    });
  }
}

// Re-export IncompatibleVectorSpaceError for convenient unified imports
export { IncompatibleVectorSpaceError };

// ============================================================================
// Vector Inspection & Validation
// ============================================================================

/**
 * Inspects a vector for mathematical validity and numerical characteristics.
 *
 * @param {Array<number>|Float32Array} vector - Vector to inspect.
 * @param {Object} [options] - Optional inspection parameters.
 * @param {number} [options.expectedDimensions] - Expected dimensional length.
 * @param {number} [options.epsilon] - Tolerance for zero and unit norm checks.
 * @returns {Object} Detailed diagnostic inspection result.
 */
export function inspectVector(vector, options = {}) {
  const epsilon = options.epsilon || 1e-6;
  const errors = [];

  if (vector === null || vector === undefined) {
    return {
      isValid: false,
      dimensions: 0,
      norm: 0,
      isZeroVector: false,
      isNormalized: false,
      hasNonFinite: false,
      errors: ['Vector is null or undefined']
    };
  }

  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) {
    return {
      isValid: false,
      dimensions: 0,
      norm: 0,
      isZeroVector: false,
      isNormalized: false,
      hasNonFinite: false,
      errors: [`Vector must be an Array or Float32Array, received ${typeof vector}`]
    };
  }

  const dimensions = vector.length;
  if (dimensions === 0) {
    return {
      isValid: false,
      dimensions: 0,
      norm: 0,
      isZeroVector: false,
      isNormalized: false,
      hasNonFinite: false,
      errors: ['Vector is empty (length is 0)']
    };
  }

  if (options.expectedDimensions !== undefined && dimensions !== options.expectedDimensions) {
    errors.push(`Vector dimension ${dimensions} does not match expected ${options.expectedDimensions}`);
  }

  let sumSquares = 0;
  let hasNonFinite = false;
  let invalidIndex = -1;
  let invalidValue = null;

  for (let i = 0; i < dimensions; i++) {
    const val = vector[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || Number.isNaN(val)) {
      hasNonFinite = true;
      if (invalidIndex === -1) {
        invalidIndex = i;
        invalidValue = val;
      }
    } else {
      sumSquares += val * val;
    }
  }

  if (hasNonFinite) {
    errors.push(`Vector contains non-finite numeric value at index ${invalidIndex}: ${invalidValue}`);
  }

  const norm = hasNonFinite ? NaN : Math.sqrt(sumSquares);
  const isZeroVector = !hasNonFinite && norm <= epsilon;
  const isNormalized = !hasNonFinite && Math.abs(norm - 1.0) <= epsilon;

  return {
    isValid: errors.length === 0,
    dimensions,
    norm: hasNonFinite ? null : Number(norm.toFixed(6)),
    isZeroVector,
    isNormalized,
    hasNonFinite,
    invalidIndex: invalidIndex >= 0 ? invalidIndex : null,
    invalidValue,
    errors
  };
}

/**
 * Validates a vector, throwing a typed error if validation fails.
 *
 * @param {Array<number>|Float32Array} vector - Vector to validate.
 * @param {Object} [options] - Validation constraints.
 * @param {number} [options.expectedDimensions] - Expected dimension length.
 * @param {boolean} [options.allowZeroVector] - Whether zero vectors are permitted (default: true).
 * @throws {InvalidVectorError|VectorDimensionMismatchError|ZeroVectorError}
 */
export function validateVector(vector, options = {}) {
  const allowZeroVector = options.allowZeroVector !== false;
  const inspection = inspectVector(vector, options);

  if (!inspection.isValid) {
    if (options.expectedDimensions !== undefined && inspection.dimensions !== options.expectedDimensions && inspection.dimensions > 0) {
      throw new VectorDimensionMismatchError(options.expectedDimensions, inspection.dimensions);
    }
    throw new InvalidVectorError(inspection.errors.join('; '));
  }

  if (!allowZeroVector && inspection.isZeroVector) {
    throw new ZeroVectorError('Zero vector encountered: vector magnitude (L2 norm) is 0.0');
  }

  return inspection;
}

// ============================================================================
// Similarity & Metric Calculations
// ============================================================================

/**
 * Computes cosine similarity between two vectors with rigorous input validation
 * and vector space compatibility verification.
 *
 * Mathematical formula:
 *   cos(A, B) = (A · B) / (||A|| * ||B||)
 *
 * @param {Array<number>|Float32Array} vecA - Vector A.
 * @param {Array<number>|Float32Array} vecB - Vector B.
 * @param {Object} [options] - Optional configurations.
 * @param {Object} [options.metaA] - Metadata for vector A (model, dimensions).
 * @param {Object} [options.metaB] - Metadata for vector B (model, dimensions).
 * @param {boolean} [options.allowZeroVector=true] - Whether to allow zero vectors (returns 0.0 if true, throws if false).
 * @param {boolean} [options.strictModelCheck=true] - Whether to throw IncompatibleVectorSpaceError on model mismatch.
 * @param {number} [options.precision=6] - Number of decimal places to round similarity.
 * @returns {number} Cosine similarity clamped between -1.0 and 1.0.
 * @throws {InvalidVectorError|VectorDimensionMismatchError|ZeroVectorError|IncompatibleVectorSpaceError}
 */
export function computeCosineSimilarity(vecA, vecB, options = {}) {
  const allowZeroVector = options.allowZeroVector !== false;
  const strictModelCheck = options.strictModelCheck !== false;
  const precision = options.precision !== undefined ? options.precision : 6;
  const metaA = options.metaA || {};
  const metaB = options.metaB || {};

  // Validate vector A
  const inspectA = validateVector(vecA, { allowZeroVector });

  // Validate vector B with dimension matching vector A
  const inspectB = validateVector(vecB, {
    expectedDimensions: inspectA.dimensions,
    allowZeroVector
  });

  // Verify vector space compatibility
  if (strictModelCheck && !isCompatibleVectorSpace(metaA, metaB)) {
    const modelA = metaA.model || metaA.modelName || metaA.embeddingModel || 'unknown_model_a';
    const modelB = metaB.model || metaB.modelName || metaB.embeddingModel || 'unknown_model_b';
    throw new IncompatibleVectorSpaceError(modelA, modelB, inspectA.dimensions, inspectB.dimensions);
  }

  // Handle zero vector case safely
  if (inspectA.isZeroVector || inspectB.isZeroVector) {
    if (!allowZeroVector) {
      throw new ZeroVectorError('Cannot compute cosine similarity: one or both vectors have zero magnitude');
    }
    return 0.0;
  }

  // Compute dot product and norms using high-precision accumulators
  let dotProduct = 0;
  let normSqA = 0;
  let normSqB = 0;

  for (let i = 0; i < inspectA.dimensions; i++) {
    const valA = vecA[i];
    const valB = vecB[i];
    dotProduct += valA * valB;
    normSqA += valA * valA;
    normSqB += valB * valB;
  }

  const denominator = Math.sqrt(normSqA) * Math.sqrt(normSqB);
  if (denominator === 0 || !Number.isFinite(denominator)) {
    return 0.0;
  }

  const rawSimilarity = dotProduct / denominator;

  // Numerical clamping to avoid floating-point drift beyond [-1.0, 1.0]
  const clamped = Math.max(-1.0, Math.min(1.0, rawSimilarity));
  return Number(clamped.toFixed(precision));
}

/**
 * Computes Euclidean (L2) distance between two vectors.
 *
 * @param {Array<number>} vecA - Vector A.
 * @param {Array<number>} vecB - Vector B.
 * @param {Object} [options] - Optional parameters.
 * @returns {number} Euclidean distance >= 0.0.
 */
export function computeEuclideanDistance(vecA, vecB, options = {}) {
  const inspectA = validateVector(vecA);
  validateVector(vecB, { expectedDimensions: inspectA.dimensions });

  let sumSquares = 0;
  for (let i = 0; i < inspectA.dimensions; i++) {
    const diff = vecA[i] - vecB[i];
    sumSquares += diff * diff;
  }

  const distance = Math.sqrt(sumSquares);
  const precision = options.precision !== undefined ? options.precision : 6;
  return Number(distance.toFixed(precision));
}

/**
 * Computes dot product between two vectors.
 *
 * @param {Array<number>} vecA - Vector A.
 * @param {Array<number>} vecB - Vector B.
 * @returns {number} Scalar dot product.
 */
export function computeDotProduct(vecA, vecB) {
  const inspectA = validateVector(vecA);
  validateVector(vecB, { expectedDimensions: inspectA.dimensions });

  let dotProduct = 0;
  for (let i = 0; i < inspectA.dimensions; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

// ============================================================================
// Deterministic Ranking Engine
// ============================================================================

/**
 * Standard disclaimer required by the Safety Invariant:
 * Semantic similarity alone does NOT establish procedural validity or safety.
 */
export const SIMILARITY_SAFETY_DISCLAIMER =
  'Semantic similarity scores measure lexical/embedding vector proximity only. ' +
  'Similarity alone DOES NOT establish operational validity, regulatory compliance, ' +
  'aircraft effectivity, or flight crew safety approval.';

/**
 * Ranks candidate chunks/documents against a query vector deterministically.
 *
 * Invariant: Tie-breaking is strictly deterministic to guarantee consistent ordering
 * across runs, platforms, and JS engines.
 *
 * @param {Array<number>} queryVector - Dense query embedding vector.
 * @param {Array<Object>} candidates - Candidate items with `{ id, vector, metadata?, text? }`.
 * @param {Object} [options] - Ranking parameters.
 * @param {Object} [options.queryMeta] - Query metadata (model, dimensions).
 * @param {number} [options.topK] - Maximum number of results to return.
 * @param {number} [options.minSimilarityThreshold] - Minimum similarity score threshold (-1.0 to 1.0).
 * @param {string|Function} [options.tieBreakerField='id'] - Field or comparator used for deterministic tie-breaking.
 * @param {boolean} [options.allowZeroVector=true] - Whether to allow zero vectors in candidates.
 * @param {boolean} [options.strictModelCheck=true] - Strict vector space compatibility check.
 * @returns {Object} Structured ranking response with scores, deterministic ordering, and safety disclaimer.
 */
export function rankBySimilarity(queryVector, candidates = [], options = {}) {
  const queryMeta = options.queryMeta || {};
  const allowZeroVector = options.allowZeroVector !== false;
  const strictModelCheck = options.strictModelCheck !== false;
  const minThreshold = options.minSimilarityThreshold !== undefined ? options.minSimilarityThreshold : -1.0;
  const topK = options.topK !== undefined ? options.topK : candidates.length;
  const tieBreakerField = options.tieBreakerField || 'id';

  // Validate query vector
  const inspectQuery = validateVector(queryVector, { allowZeroVector });

  if (!Array.isArray(candidates)) {
    throw new InvalidVectorError(`Candidates must be an array, received ${typeof candidates}`);
  }

  const scored = [];

  for (let idx = 0; idx < candidates.length; idx++) {
    const candidate = candidates[idx];
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const candidateVector = candidate.vector || candidate.embedding || null;
    if (!candidateVector) {
      continue;
    }

    const candidateMeta = {
      model: candidate.embeddingModel || (candidate.metadata && candidate.metadata.embeddingModel) || queryMeta.model,
      dimensions: candidate.embeddingDimensions || (candidate.metadata && candidate.metadata.embeddingDimensions) || queryMeta.dimensions
    };

    const similarity = computeCosineSimilarity(queryVector, candidateVector, {
      metaA: queryMeta,
      metaB: candidateMeta,
      allowZeroVector,
      strictModelCheck,
      precision: options.precision || 6
    });

    if (similarity >= minThreshold) {
      const candidateId = candidate.id || (candidate.metadata && candidate.metadata.chunkId) || `candidate_${idx}`;
      const status = (candidate.metadata && candidate.metadata.status) || candidate.status || 'UNSPECIFIED';
      const isSuperseded = status === 'SUPERSEDED' || Boolean(candidate.metadata && candidate.metadata.supersededBy);

      scored.push({
        id: candidateId,
        similarity,
        candidateIndex: idx,
        chunkIndex: (candidate.metadata && candidate.metadata.chunk_index !== undefined)
          ? candidate.metadata.chunk_index
          : (candidate.chunkIndex !== undefined ? candidate.chunkIndex : idx),
        status,
        isSuperseded,
        text: candidate.text || '',
        metadata: candidate.metadata || {},
        originalCandidate: candidate
      });
    }
  }

  // Deterministic Sorting:
  // Primary: similarity DESC
  // Secondary (Tie-breaker): deterministic comparator
  scored.sort((a, b) => {
    const scoreDiff = b.similarity - a.similarity;
    if (Math.abs(scoreDiff) > 1e-9) {
      return scoreDiff;
    }

    // Deterministic tie-breaker
    if (typeof tieBreakerField === 'function') {
      return tieBreakerField(a, b);
    }

    const valA = String(a[tieBreakerField] !== undefined ? a[tieBreakerField] : a.id);
    const valB = String(b[tieBreakerField] !== undefined ? b[tieBreakerField] : b.id);
    const stringComparison = valA.localeCompare(valB);
    if (stringComparison !== 0) {
      return stringComparison;
    }

    // Fallback tie-breaker: chunkIndex ascending
    return (a.chunkIndex || 0) - (b.chunkIndex || 0);
  });

  // Top-K slicing
  const sliced = scored.slice(0, Math.max(0, topK));

  // Decorate with 1-based rank
  const results = sliced.map((item, index) => ({
    rank: index + 1,
    id: item.id,
    similarity: item.similarity,
    chunkIndex: item.chunkIndex,
    status: item.status,
    isSuperseded: item.isSuperseded,
    text: item.text,
    metadata: item.metadata
  }));

  return {
    queryMeta: {
      dimensions: inspectQuery.dimensions,
      model: queryMeta.model || null
    },
    totalCandidates: candidates.length,
    matchedCandidates: scored.length,
    returnedCandidates: results.length,
    safetyDisclaimer: SIMILARITY_SAFETY_DISCLAIMER,
    results
  };
}

export default {
  inspectVector,
  validateVector,
  computeCosineSimilarity,
  computeEuclideanDistance,
  computeDotProduct,
  rankBySimilarity,
  SIMILARITY_SAFETY_DISCLAIMER,
  SimilarityError,
  InvalidVectorError,
  VectorDimensionMismatchError,
  ZeroVectorError,
  IncompatibleVectorSpaceError
};
