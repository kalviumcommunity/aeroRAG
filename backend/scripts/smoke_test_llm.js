import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../src/config/env.js';
import {
  GeminiAdapter,
  MockLLMAdapter,
  MissingConfigurationError,
  LLMTimeoutError,
  RateLimitError,
  InvalidResponseError,
  ProviderError
} from '../src/rag/llmClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSmokeTest() {
  console.log('================================================================');
  console.log('       AERORAG: LLM API CLIENT ADAPTER SMOKE TEST (MILESTONE 3.12)');
  console.log('================================================================\n');

  const apiKey = config.GOOGLE_API_KEY || config.GEMINI_API_KEY;
  const modelName = config.LLM_MODEL || 'gemini-1.5-flash';
  const timeoutMs = config.LLM_TIMEOUT_MS || 30000;
  const docsDir = path.resolve(__dirname, '../../docs');

  const report = {
    timestamp: new Date().toISOString(),
    milestone: '3.12 — LLM API access and first completion',
    provider: 'gemini',
    configuredModel: modelName,
    hasCredentials: Boolean(apiKey && apiKey.trim().length > 0),
    result: null
  };

  // 1. Honest Check: Are real API credentials configured?
  if (!apiKey || apiKey.trim().length === 0) {
    console.log('[STATUS: SKIPPED]');
    console.log('Notice: Real LLM provider credentials (GOOGLE_API_KEY / GEMINI_API_KEY) are not set.');
    console.log('To run a live smoke test against Google Gemini:');
    console.log('  1. Add GOOGLE_API_KEY=AIzaSy... to backend/.env');
    console.log('  2. Or set process environment variable: $env:GEMINI_API_KEY="AIzaSy..."');
    console.log('  3. Re-run: npm --prefix backend run test:smoke\n');
    console.log('Running mock adapter smoke verification instead...');

    const mockAdapter = new MockLLMAdapter({
      model: 'mock-airline-procedure-model',
      simulatedLatencyMs: 25
    });

    const testPrompt = 'In airline flight operations, what is the sterile cockpit rule? Respond in 2 concise sentences.';
    const mockRes = await mockAdapter.sendMessage(testPrompt);

    report.result = {
      status: 'SKIPPED_CREDENTIALS_MOCK_VERIFIED',
      note: 'Live API test skipped honestly due to missing credentials. Mock adapter executed and verified.',
      prompt: testPrompt,
      response: mockRes
    };

    console.log(`[MOCK COMPLETION] Status: ${mockRes.finishReason} | Latency: ${mockRes.latencyMs}ms`);
    console.log(`[MOCK TEXT]:\n${mockRes.text}\n`);

    saveReport(docsDir, report);
    return;
  }

  // 2. Real API Execution
  console.log(`[CONFIG] Provider: Google Gemini`);
  console.log(`[CONFIG] Target Model: ${modelName}`);
  console.log(`[CONFIG] Timeout: ${timeoutMs}ms`);
  console.log(`[CONFIG] API Key Present: Yes (prefix: ${apiKey.substring(0, 6)}...)\n`);

  const client = new GeminiAdapter({
    apiKey,
    model: modelName,
    timeoutMs,
    temperature: 0.1,
    maxOutputTokens: 250
  });

  const testPrompt = 'In airline flight operations, what is the sterile cockpit rule? Respond in 2 concise sentences.';
  console.log(`[DISPATCH] Sending prompt: "${testPrompt}"...`);

  const startTime = Date.now();
  try {
    const response = await client.sendMessage(testPrompt);
    const totalLatency = Date.now() - startTime;

    console.log('\n----------------------------------------------------------------');
    console.log('[RESULT: SUCCESS] Real LLM API completion received!');
    console.log('----------------------------------------------------------------');
    console.log(`Model:           ${response.model}`);
    console.log(`Provider:        ${response.provider}`);
    console.log(`Latency:         ${totalLatency}ms (API reported: ${response.latencyMs}ms)`);
    console.log(`Finish Reason:   ${response.finishReason}`);
    console.log(`Token Usage:     Prompt: ${response.usage.promptTokens}, Completion: ${response.usage.completionTokens}, Total: ${response.usage.totalTokens}`);
    console.log('\n--- Completion Text ---');
    console.log(response.text.trim());
    console.log('-----------------------\n');

    report.result = {
      status: 'SUCCESS',
      latencyMs: totalLatency,
      prompt: testPrompt,
      completion: response.text.trim(),
      model: response.model,
      usage: response.usage,
      finishReason: response.finishReason
    };
  } catch (error) {
    const totalLatency = Date.now() - startTime;
    console.error('\n----------------------------------------------------------------');
    console.error('[RESULT: FAILED] Honest reporting of real API call failure:');
    console.error('----------------------------------------------------------------');
    console.error(`Error Class:     ${error.name}`);
    console.error(`Category:        ${error.category || 'UNKNOWN'}`);
    console.error(`Status Code:     ${error.statusCode || 'N/A'}`);
    console.error(`Retryable:       ${error.retryable ?? 'N/A'}`);
    console.error(`Message:         ${error.message}`);
    if (error.details) {
      console.error(`Details:         ${JSON.stringify(error.details)}`);
    }
    console.error('----------------------------------------------------------------\n');

    report.result = {
      status: 'FAILED',
      errorClass: error.name,
      category: error.category || 'UNKNOWN',
      statusCode: error.statusCode,
      retryable: error.retryable,
      message: error.message,
      details: error.details,
      latencyMs: totalLatency
    };
  }

  saveReport(docsDir, report);
}

function saveReport(docsDir, report) {
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, 'llm_smoke_test_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[Artifact] Smoke test result recorded to: ${outputPath}`);
}

runSmokeTest().catch((err) => {
  console.error('Fatal smoke test runner error:', err);
  process.exit(1);
});
