import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ContextBudgetManager,
  ContextBudgetExceededError,
  OversizedMessageError,
  DEFAULT_MODEL_PRICING,
  estimateTokenCount,
  estimateTokenCountSync,
  calculateCost
} from '../src/rag/tokenContextManager.js';

import { MockLLMAdapter } from '../src/rag/llmClient.js';

describe('Milestones 3.14 & 3.15: Tokens, Cost Estimation & Context Budget Management', () => {

  // ==========================================================================
  // Suite 1: Token Estimation Utilities
  // ==========================================================================
  describe('Token Estimation & Counting', () => {
    it('should return 0 tokens and isExact: true for empty or null inputs', async () => {
      const emptyStr = await estimateTokenCount('');
      assert.equal(emptyStr.tokenCount, 0);
      assert.equal(emptyStr.charCount, 0);
      assert.equal(emptyStr.isExact, true);
      assert.equal(emptyStr.method, 'empty_input');

      const nullInput = await estimateTokenCount(null);
      assert.equal(nullInput.tokenCount, 0);
      assert.equal(nullInput.isExact, true);
    });

    it('should estimate token count for standard text and indicate approximation', async () => {
      const text = 'Sterile cockpit procedures are mandatory below 10,000 feet MSL.';
      const res = await estimateTokenCount(text, { model: 'gemini-3.5-flash-lite' });

      assert.ok(res.tokenCount > 10 && res.tokenCount < 25);
      assert.equal(res.charCount, text.length);
      assert.equal(res.isExact, false);
      assert.equal(res.method, 'heuristic_estimation');
      assert.equal(res.model, 'gemini-3.5-flash-lite');
    });

    it('should estimate token count for dialogue message arrays', async () => {
      const messages = [
        { role: 'user', content: 'What is V1 speed?' },
        { role: 'assistant', content: 'V1 is the takeoff decision speed.' }
      ];
      const res = await estimateTokenCount(messages);

      assert.ok(res.tokenCount > 10);
      assert.ok(res.charCount > 0);
      assert.equal(res.isExact, false);
    });

    it('should use exact model tokenizer when modelInstance with countTokens is available', async () => {
      const mockTokenizerModel = {
        countTokens: async (text) => ({ totalTokens: 42 })
      };

      const res = await estimateTokenCount('Technical flight manual excerpt', {
        modelInstance: mockTokenizerModel,
        model: 'gemini-1.5-pro'
      });

      assert.equal(res.tokenCount, 42);
      assert.equal(res.isExact, true);
      assert.equal(res.method, 'model_tokenizer');
    });

    it('should support synchronous token estimation identically', () => {
      const text = 'Boeing 737 Quick Reference Handbook (QRH) Section 5.';
      const syncCount = estimateTokenCountSync(text);
      assert.ok(syncCount > 5);
      assert.equal(estimateTokenCountSync(''), 0);
    });
  });

  // ==========================================================================
  // Suite 2: Cost Calculation (Calculated ONLY When Pricing Data Is Available)
  // ==========================================================================
  describe('Cost Estimation', () => {
    it('should calculate cost with 6-decimal precision for known models', () => {
      const usage = {
        promptTokens: 100_000,
        completionTokens: 50_000,
        totalTokens: 150_000
      };

      // gemini-3.5-flash-lite: $0.075 / 1M prompt, $0.30 / 1M completion
      const cost = calculateCost(usage, 'gemini-3.5-flash-lite');

      assert.equal(cost.pricingAvailable, true);
      assert.equal(cost.isExactPricing, true);
      assert.equal(cost.currency, 'USD');
      assert.equal(cost.promptCostUsd, 0.0075);
      assert.equal(cost.completionCostUsd, 0.015);
      assert.equal(cost.totalCostUsd, 0.0225);
    });

    it('should return $0.00 cost when token counts are zero', () => {
      const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const cost = calculateCost(usage, 'gemini-3.5-flash-lite');

      assert.equal(cost.pricingAvailable, true);
      assert.equal(cost.totalCostUsd, 0);
      assert.equal(cost.promptCostUsd, 0);
      assert.equal(cost.completionCostUsd, 0);
    });

    it('should support custom pricing overrides via options', () => {
      const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000 };
      const cost = calculateCost(usage, 'custom-llm', {
        inputCostPerM: 2.00,
        outputCostPerM: 8.00
      });

      assert.equal(cost.pricingAvailable, true);
      assert.equal(cost.promptCostUsd, 2.00);
      assert.equal(cost.completionCostUsd, 8.00);
      assert.equal(cost.totalCostUsd, 10.00);
    });

    it('should safely return pricingAvailable: false when model pricing is unconfigured', () => {
      const usage = { promptTokens: 50_000, completionTokens: 20_000 };
      const cost = calculateCost(usage, 'unregistered-experimental-model-2026');

      // CRITICAL: Must not invent fabricated costs!
      assert.equal(cost.pricingAvailable, false);
      assert.equal(cost.isExactPricing, false);
      assert.equal(cost.totalCostUsd, null);
      assert.equal(cost.promptCostUsd, null);
      assert.equal(cost.completionCostUsd, null);
      assert.ok(cost.reason.includes('No pricing data configured'));
    });
  });

  // ==========================================================================
  // Suite 3: Context Budget Allocation & Safety Invariants
  // ==========================================================================
  describe('Context Budget Management & Evidence Protection', () => {
    it('should calculate budget allocation across system, query, response reserve, and evidence', () => {
      const manager = new ContextBudgetManager({
        maxContextTokens: 4000,
        reservedResponseTokens: 500,
        maxHistoryTokens: 1000
      });

      const budget = manager.calculateBudget({
        systemPrompt: 'System safety instructions.',
        query: 'What is crosswind limit?',
        chunks: [
          { document: 'Crosswind limit on dry runway is 33 knots.' }
        ]
      });

      assert.equal(budget.maxContextTokens, 4000);
      assert.equal(budget.responseReserve, 500);
      assert.ok(budget.systemTokens > 0);
      assert.ok(budget.queryTokens > 0);
      assert.ok(budget.evidenceTokens > 0);
      assert.ok(budget.historyBudget > 0);
      assert.ok(budget.totalCommittedTokens < 4000);
    });

    it('should throw ContextBudgetExceededError when fixed requirements exceed window', () => {
      const tinyManager = new ContextBudgetManager({
        maxContextTokens: 100,
        reservedResponseTokens: 80
      });

      assert.throws(
        () => tinyManager.calculateBudget({
          systemPrompt: 'Very long system prompt that will easily exceed remaining 20 tokens...',
          query: 'Detailed query that takes tokens'
        }),
        (err) => {
          assert.ok(err instanceof ContextBudgetExceededError);
          assert.equal(err.category, 'BUDGET_EXCEEDED');
          return true;
        }
      );
    });

    it('SAFETY INVARIANT: Should never silently remove safety-critical evidence when budget is tight', () => {
      const manager = new ContextBudgetManager({
        maxContextTokens: 300,
        reservedResponseTokens: 100
      });

      const massiveEvidenceChunk = {
        document: 'A'.repeat(1200) // ~300+ tokens
      };

      // Attempting to fit evidence larger than available context headroom MUST throw
      // rather than silently omitting or cutting safety-critical flight procedures
      assert.throws(
        () => manager.calculateBudget({
          systemPrompt: 'System instructions',
          query: 'Check evacuation sequence',
          chunks: [massiveEvidenceChunk]
        }),
        (err) => {
          assert.ok(err instanceof ContextBudgetExceededError);
          assert.ok(err.message.includes('safety-critical evidence'));
          assert.ok(err.message.includes('cannot be silently truncated'));
          assert.equal(err.details.safetyInvariant, 'Never silently remove safety-critical evidence');
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Suite 4: Bounded Conversation History & Truncation
  // ==========================================================================
  describe('Bounded Conversation History', () => {
    const manager = new ContextBudgetManager({ maxContextTokens: 4000 });

    it('should handle empty or null conversation history gracefully', async () => {
      const emptyRes = await manager.manageHistory([], 500);
      assert.deepEqual(emptyRes.messages, []);
      assert.equal(emptyRes.trimmedCount, 0);
      assert.equal(emptyRes.totalTokens, 0);
      assert.equal(emptyRes.wasTruncated, false);

      const nullRes = await manager.manageHistory(null, 500);
      assert.deepEqual(nullRes.messages, []);
      assert.equal(nullRes.trimmedCount, 0);
    });

    it('should preserve history in full when within budget', async () => {
      const history = [
        { role: 'user', content: 'Check flaps 15 speed.' },
        { role: 'assistant', content: 'Flaps 15 maximum speed is 205 knots.' }
      ];

      const res = await manager.manageHistory(history, 1000);
      assert.equal(res.messages.length, 2);
      assert.equal(res.trimmedCount, 0);
      assert.equal(res.wasTruncated, false);
      assert.equal(res.summary, null);
    });

    it('should deterministically truncate oldest dialogue turns (FIFO) when exceeding budget', async () => {
      const history = [
        { role: 'user', content: 'Turn 1: Check fuel density.' },
        { role: 'assistant', content: 'Turn 1 Answer: 0.8 kg/L.' },
        { role: 'user', content: 'Turn 2: Check fuel reserves.' },
        { role: 'assistant', content: 'Turn 2 Answer: 45 minutes reserve required.' },
        { role: 'user', content: 'Turn 3: Check alternate airport.' },
        { role: 'assistant', content: 'Turn 3 Answer: Alternate airport is required.' }
      ];

      // Restrict history budget so only the last ~2 turns can fit
      const res = await manager.manageHistory(history, 40);

      assert.ok(res.wasTruncated);
      assert.ok(res.trimmedCount > 0);
      assert.ok(res.messages.length < history.length);
      // Newest messages must be preserved at the tail
      const lastMessage = res.messages[res.messages.length - 1];
      assert.equal(lastMessage.content, 'Turn 3 Answer: Alternate airport is required.');
    });

    it('should invoke summarization hook when dialogue turns are dropped', async () => {
      const history = [
        { role: 'user', content: 'Old question 1: How do we handle low fuel emergency situation?' },
        { role: 'assistant', content: 'Old answer 1: Declare MAYDAY FUEL when less than 30 min remain.' },
        { role: 'user', content: 'Recent question 2: What about alternate airport distance?' }
      ];

      let hookCalledWith = null;
      const summarizeHook = async (droppedMessages) => {
        hookCalledWith = droppedMessages;
        return 'Summary of older fuel discussion';
      };

      // Set small budget (20 tokens) so older turns must be trimmed
      const res = await manager.manageHistory(history, 20, { summarizeHook });

      assert.ok(res.wasTruncated);
      assert.ok(hookCalledWith && hookCalledWith.length > 0);
      assert.equal(res.summary, 'Summary of older fuel discussion');
      // Summary message is inserted at head of messages
      assert.equal(res.messages[0].role, 'system');
      assert.ok(res.messages[0].content.includes('PRIOR CONVERSATION SUMMARY:'));
    });

    it('should handle summarization hook errors gracefully without crashing', async () => {
      const history = [
        { role: 'user', content: 'Question 1: Explain rejected takeoff high speed abort criteria.' },
        { role: 'assistant', content: 'Answer 1: Above 80 knots only abort for fire, engine failure, or unsafe flight.' },
        { role: 'user', content: 'Question 2: What about tire failure?' }
      ];

      const failingHook = async () => {
        throw new Error('LLM summarization service unreachable');
      };

      // Set small budget (15 tokens)
      const res = await manager.manageHistory(history, 15, { summarizeHook: failingHook });
      // Should fall back cleanly to standard truncation
      assert.ok(res.wasTruncated);
      assert.equal(res.summary, null);
    });
  });

  // ==========================================================================
  // Suite 5: Oversized Message Handling
  // ==========================================================================
  describe('Oversized Message Handling', () => {
    const manager = new ContextBudgetManager({ maxContextTokens: 1000 });

    it('should throw OversizedMessageError when single message exceeds threshold', async () => {
      const hugeMessage = {
        role: 'user',
        content: 'Dangerous prompt injection / buffer overflow '.repeat(300) // ~2400 chars, ~600+ tokens
      };

      await assert.rejects(
        async () => await manager.manageHistory([hugeMessage], 500, { maxSingleMessageTokens: 200 }),
        (err) => {
          assert.ok(err instanceof OversizedMessageError);
          assert.equal(err.category, 'OVERSIZED_MESSAGE');
          assert.ok(err.details.msgTokens > 200);
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // Suite 6: LLM Client Adapter Integration
  // ==========================================================================
  describe('LLM Client Adapter Cost & Token Integration', () => {
    it('should populate usage and calculate cost automatically in completion responses', async () => {
      const adapter = new MockLLMAdapter({
        model: 'gemini-3.5-flash-lite',
        cannedResponse: 'Standard Boeing 737 crosswind limit.'
      });

      const response = await adapter.sendMessage('Check crosswind limit');

      assert.ok(response.usage);
      assert.ok(response.usage.promptTokens > 0);
      assert.ok(response.usage.completionTokens > 0);
      assert.ok(response.cost);
      assert.equal(response.cost.pricingAvailable, true);
      assert.equal(typeof response.cost.totalCostUsd, 'number');
      assert.equal(response.cost.model, 'gemini-3.5-flash-lite');
    });
  });
});
