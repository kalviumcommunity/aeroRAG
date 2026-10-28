import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  BaseLLMAdapter,
  GeminiAdapter,
  MockLLMAdapter,
  createLLMClient,
  getLLMClient,
  LLMClientError,
  MissingConfigurationError,
  LLMTimeoutError,
  RateLimitError,
  InvalidResponseError,
  ProviderError
} from '../src/rag/llmClient.js';

describe('Milestone 3.12: LLM Client Adapter & Error Handling', () => {

  describe('Error Hierarchy & Classification', () => {
    it('should create base LLMClientError with default attributes', () => {
      const err = new LLMClientError('General failure');
      assert.equal(err.name, 'LLMClientError');
      assert.equal(err.message, 'General failure');
      assert.equal(err.category, 'GENERAL_ERROR');
      assert.equal(err.statusCode, 500);
      assert.equal(err.retryable, false);
      assert.ok(err instanceof Error);
    });

    it('should create MissingConfigurationError with actionable guidance', () => {
      const err = new MissingConfigurationError('API key not found');
      assert.equal(err.name, 'MissingConfigurationError');
      assert.equal(err.category, 'MISSING_CONFIGURATION');
      assert.equal(err.statusCode, 400);
      assert.equal(err.retryable, false);
      assert.ok(err.details);
      assert.ok(Array.isArray(err.details.requiredEnvVars));
    });

    it('should create LLMTimeoutError with timeout tracking', () => {
      const err = new LLMTimeoutError('Request timed out', { timeoutMs: 5000 });
      assert.equal(err.name, 'LLMTimeoutError');
      assert.equal(err.category, 'TIMEOUT');
      assert.equal(err.statusCode, 504);
      assert.equal(err.retryable, true);
      assert.equal(err.timeoutMs, 5000);
    });

    it('should create RateLimitError with retry-after hint', () => {
      const err = new RateLimitError('Quota exceeded', { retryAfterMs: 4000 });
      assert.equal(err.name, 'RateLimitError');
      assert.equal(err.category, 'RATE_LIMIT');
      assert.equal(err.statusCode, 429);
      assert.equal(err.retryable, true);
      assert.equal(err.retryAfterMs, 4000);
    });

    it('should create InvalidResponseError with diagnostic details', () => {
      const err = new InvalidResponseError('Zero candidates returned', {
        details: { candidates: [] }
      });
      assert.equal(err.name, 'InvalidResponseError');
      assert.equal(err.category, 'INVALID_RESPONSE');
      assert.equal(err.statusCode, 502);
      assert.equal(err.retryable, false);
      assert.deepEqual(err.details, { candidates: [] });
    });

    it('should create ProviderError with upstream status code', () => {
      const err = new ProviderError('Internal server error at provider', {
        statusCode: 503
      });
      assert.equal(err.name, 'ProviderError');
      assert.equal(err.category, 'PROVIDER_ERROR');
      assert.equal(err.statusCode, 503);
      assert.equal(err.retryable, true);
    });
  });

  describe('MockLLMAdapter (Zero-Cost Automated Testing)', () => {
    let adapter;

    beforeEach(() => {
      adapter = new MockLLMAdapter({
        model: 'mock-b737-assistant',
        simulatedLatencyMs: 0
      });
    });

    it('should return a standardized completion response for a simple prompt string', async () => {
      const prompt = 'What is the sterile cockpit rule?';
      const response = await adapter.sendMessage(prompt);

      assert.ok(response);
      assert.equal(typeof response.text, 'string');
      assert.ok(response.text.includes('AERORAG MOCK COMPLETION'));
      assert.equal(response.model, 'mock-b737-assistant');
      assert.equal(response.provider, 'mock');
      assert.ok(response.usage.promptTokens > 0);
      assert.ok(response.usage.completionTokens > 0);
      assert.equal(response.usage.totalTokens, response.usage.promptTokens + response.usage.completionTokens);
      assert.equal(response.finishReason, 'STOP');
      assert.equal(typeof response.latencyMs, 'number');
      assert.ok(response.metadata);
    });

    it('should normalize chat message arrays into structured prompt', async () => {
      const messages = [
        { role: 'system', content: 'You are an airline safety assistant.' },
        { role: 'user', content: 'Explain rejected takeoff criteria.' }
      ];

      const response = await adapter.sendMessage(messages);
      assert.ok(response.text);
      assert.equal(adapter.callCount, 1);
      assert.ok(adapter.lastCall.prompt.includes('SYSTEM: You are an airline safety assistant.'));
      assert.ok(adapter.lastCall.prompt.includes('USER: Explain rejected takeoff criteria.'));
    });

    it('should deliver custom canned response string', async () => {
      const canned = new MockLLMAdapter({
        cannedResponse: 'Sterile cockpit is mandatory below 10,000 feet MSL.'
      });

      const response = await canned.sendMessage('Verify altitude limit');
      assert.equal(response.text, 'Sterile cockpit is mandatory below 10,000 feet MSL.');
    });

    it('should deliver dynamic response from canned function', async () => {
      const dynamic = new MockLLMAdapter({
        cannedResponse: (prompt) => `Verified response to: ${prompt.trim()}`
      });

      const response = await dynamic.sendMessage('Check fuel reserve requirements');
      assert.equal(response.text, 'Verified response to: Check fuel reserve requirements');
    });

    it('should cycle through sequential mockResponses', async () => {
      const multi = new MockLLMAdapter({
        mockResponses: ['First answer: Check flaps', 'Second answer: Check gear']
      });

      const resp1 = await multi.sendMessage('Step 1');
      const resp2 = await multi.sendMessage('Step 2');
      assert.equal(resp1.text, 'First answer: Check flaps');
      assert.equal(resp2.text, 'Second answer: Check gear');
    });

    it('should accurately simulate stopSequences', async () => {
      const stopped = new MockLLMAdapter({
        cannedResponse: 'Line 1\nLine 2\nSTOP_HERE\nLine 3'
      });

      const resp = await stopped.sendMessage('Query', {
        stopSequences: ['\nSTOP_HERE']
      });
      assert.equal(resp.text, 'Line 1\nLine 2');
    });

    it('should simulate maxOutputTokens truncation', async () => {
      const longText = 'A'.repeat(500);
      const truncating = new MockLLMAdapter({
        cannedResponse: longText
      });

      const resp = await truncating.sendMessage('Query', { maxOutputTokens: 20 });
      assert.ok(resp.text.includes('[TRUNCATED]'));
      assert.ok(resp.text.length < 500);
    });

    it('should record call telemetry and support resetHistory', async () => {
      await adapter.sendMessage('Call 1');
      await adapter.sendMessage('Call 2');
      assert.equal(adapter.callCount, 2);
      assert.equal(adapter.history.length, 2);
      assert.equal(adapter.lastCall.prompt, 'Call 2');

      adapter.resetHistory();
      assert.equal(adapter.callCount, 0);
      assert.equal(adapter.history.length, 0);
      assert.equal(adapter.lastCall, null);
    });
  });

  describe('Mock Safe Error Handling Verification', () => {
    it('should simulate MissingConfigurationError when requested', async () => {
      const mock = new MockLLMAdapter({ simulateMissingConfig: true });
      await assert.rejects(
        async () => await mock.sendMessage('Hello'),
        (err) => {
          assert.ok(err instanceof MissingConfigurationError);
          assert.equal(err.category, 'MISSING_CONFIGURATION');
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it('should simulate LLMTimeoutError safely without unhandled rejection', async () => {
      const mock = new MockLLMAdapter({ simulateTimeout: true });
      await assert.rejects(
        async () => await mock.sendMessage('Slow request', { timeoutMs: 50 }),
        (err) => {
          assert.ok(err instanceof LLMTimeoutError);
          assert.equal(err.category, 'TIMEOUT');
          assert.equal(err.statusCode, 504);
          assert.equal(err.timeoutMs, 50);
          assert.equal(err.retryable, true);
          return true;
        }
      );
    });

    it('should simulate RateLimitError (429) safely', async () => {
      const mock = new MockLLMAdapter({ simulateRateLimit: true });
      await assert.rejects(
        async () => await mock.sendMessage('Spam query'),
        (err) => {
          assert.ok(err instanceof RateLimitError);
          assert.equal(err.category, 'RATE_LIMIT');
          assert.equal(err.statusCode, 429);
          assert.equal(err.retryable, true);
          assert.equal(err.retryAfterMs, 3000);
          return true;
        }
      );
    });

    it('should simulate InvalidResponseError safely', async () => {
      const mock = new MockLLMAdapter({ simulateInvalidResponse: true });
      await assert.rejects(
        async () => await mock.sendMessage('Query expecting invalid structure'),
        (err) => {
          assert.ok(err instanceof InvalidResponseError);
          assert.equal(err.category, 'INVALID_RESPONSE');
          assert.equal(err.statusCode, 502);
          assert.equal(err.retryable, false);
          return true;
        }
      );
    });

    it('should simulate ProviderError (503 Service Unavailable) safely', async () => {
      const mock = new MockLLMAdapter({
        simulateProviderError: { message: 'Cloud region offline', statusCode: 503 }
      });
      await assert.rejects(
        async () => await mock.sendMessage('Query'),
        (err) => {
          assert.ok(err instanceof ProviderError);
          assert.equal(err.category, 'PROVIDER_ERROR');
          assert.equal(err.statusCode, 503);
          assert.equal(err.retryable, true);
          assert.equal(err.message, 'Cloud region offline');
          return true;
        }
      );
    });
  });

  describe('GeminiAdapter Configuration & Safety Validation', () => {
    it('should throw MissingConfigurationError when no API key is supplied', async () => {
      const unconfigured = new GeminiAdapter({ apiKey: '', model: 'gemini-1.5-flash' });
      await assert.rejects(
        async () => await unconfigured.sendMessage('Test query'),
        (err) => {
          assert.ok(err instanceof MissingConfigurationError);
          assert.ok(err.message.includes('API key is missing'));
          return true;
        }
      );
    });

    it('should reject empty or whitespace prompt with InvalidResponseError', async () => {
      const adapter = new GeminiAdapter({ apiKey: 'fake-test-key-12345', model: 'gemini-1.5-flash' });
      await assert.rejects(
        async () => await adapter.sendMessage('   '),
        (err) => {
          assert.ok(err instanceof InvalidResponseError);
          assert.ok(err.message.includes('Prompt cannot be empty'));
          return true;
        }
      );
    });

    it('should initialize with configurable settings from options', () => {
      const adapter = new GeminiAdapter({
        apiKey: 'test-key',
        model: 'gemini-1.5-pro',
        timeoutMs: 15000,
        temperature: 0.2,
        maxOutputTokens: 1000,
        topP: 0.95
      });

      assert.equal(adapter.provider, 'gemini');
      assert.equal(adapter.model, 'gemini-1.5-pro');
      assert.equal(adapter.timeoutMs, 15000);
      assert.equal(adapter.defaultTemperature, 0.2);
      assert.equal(adapter.defaultMaxTokens, 1000);
      assert.equal(adapter.defaultTopP, 0.95);
      assert.ok(adapter.genAI !== null);
    });
  });

  describe('Factory: createLLMClient & getLLMClient', () => {
    it('should create MockLLMAdapter when mock option is true', () => {
      const client = createLLMClient({ mock: true, model: 'test-mock' });
      assert.ok(client instanceof MockLLMAdapter);
      assert.equal(client.provider, 'mock');
      assert.equal(client.model, 'test-mock');
    });

    it('should create MockLLMAdapter when provider is mock', () => {
      const client = createLLMClient({ provider: 'mock' });
      assert.ok(client instanceof MockLLMAdapter);
    });

    it('should create GeminiAdapter when credentials are provided', () => {
      const client = createLLMClient({
        provider: 'gemini',
        apiKey: 'test-api-key',
        model: 'gemini-1.5-flash'
      });
      assert.ok(client instanceof GeminiAdapter);
      assert.equal(client.provider, 'gemini');
      assert.equal(client.model, 'gemini-1.5-flash');
    });

    it('should return singleton instance from getLLMClient', () => {
      const client1 = getLLMClient();
      const client2 = getLLMClient();
      assert.equal(client1, client2);
    });
  });
});
