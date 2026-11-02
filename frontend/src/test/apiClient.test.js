import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../api/client.js';

describe('API error messages', () => {
  it('prefers a server-provided error message', () => {
    expect(getErrorMessage({ response: { data: { error: 'Database unavailable' } } }))
      .toBe('Database unavailable');
  });

  it('distinguishes an unreachable API from a server response', () => {
    expect(getErrorMessage({ request: {} }))
      .toMatch(/Cannot reach the AeroRAG API/);
  });
});
