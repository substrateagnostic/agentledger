/**
 * @agentledger/langchain
 * LangChain integration for AgentLedger
 * 
 * Provides a CallbackHandler that automatically captures LLM calls, tool uses, and chain executions.
 */

import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { Serialized } from '@langchain/core/load/serializable';
import type { LLMResult } from '@langchain/core/outputs';
import type { AgentAction, AgentFinish } from '@langchain/core/agents';
import type { ChainValues } from '@langchain/core/utils/types';
import type { Document } from '@langchain/core/documents';

import { Ledger, hashContent } from 'agentledger-core';

// ============================================================================
// TYPES
// ============================================================================

interface RunInfo {
  runId: string;
  parentRunId?: string;
  startTime: number;
  promptHash?: string;
  promptTokens?: number;
}

// ============================================================================
// CALLBACK HANDLER
// ============================================================================

export class AgentLedgerCallbackHandler extends BaseCallbackHandler {
  name = 'AgentLedgerCallbackHandler';
  
  private ledger: Ledger;
  private runStack: Map<string, RunInfo> = new Map();
  private verbose: boolean;
  
  constructor(ledger: Ledger, options?: { verbose?: boolean }) {
    super();
    this.ledger = ledger;
    this.verbose = options?.verbose ?? false;
  }
  
  // ============================================================================
  // LLM CALLBACKS
  // ============================================================================
  
  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const promptText = prompts.join('\n');
    
    this.runStack.set(runId, {
      runId,
      parentRunId,
      startTime: Date.now(),
      promptHash: hashContent(promptText),
      promptTokens: this.estimateTokens(promptText),
    });
    
    if (this.verbose) {
      console.log(`[AgentLedger] LLM Start: ${runId}`);
    }
  }
  
  async handleLLMEnd(
    output: LLMResult,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    const completionText = output.generations
      .map(gen => gen.map(g => g.text).join(''))
      .join('\n');
    
    const latencyMs = Date.now() - runInfo.startTime;
    const completionTokens = this.estimateTokens(completionText);
    
    // Extract model info from LLM result
    const llmOutput = output.llmOutput || {};
    const modelName = llmOutput.modelName || llmOutput.model || 'unknown';
    const tokenUsage = llmOutput.tokenUsage || {};
    
    await this.ledger.logModelCall({
      provider: this.inferProvider(modelName),
      modelId: modelName,
      parameters: {},
      promptHash: runInfo.promptHash!,
      promptTokens: tokenUsage.promptTokens || runInfo.promptTokens || 0,
      completionHash: hashContent(completionText),
      completionTokens: tokenUsage.completionTokens || completionTokens,
      latencyMs,
      costUsd: this.estimateCost(modelName, tokenUsage.promptTokens || 0, tokenUsage.completionTokens || 0),
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] LLM End: ${runId} (${latencyMs}ms)`);
    }
  }
  
  async handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    await this.ledger.logModelCall({
      provider: 'custom',
      modelId: 'unknown',
      parameters: {},
      promptHash: runInfo.promptHash || '',
      promptTokens: runInfo.promptTokens || 0,
      completionHash: '',
      completionTokens: 0,
      latencyMs: Date.now() - runInfo.startTime,
      error: {
        code: err.name || 'ERROR',
        message: err.message,
        retryable: this.isRetryable(err),
      },
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] LLM Error: ${runId} - ${err.message}`);
    }
  }
  
  // ============================================================================
  // TOOL CALLBACKS
  // ============================================================================
  
  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.runStack.set(runId, {
      runId,
      parentRunId,
      startTime: Date.now(),
      promptHash: hashContent(input),
    });
    
    if (this.verbose) {
      console.log(`[AgentLedger] Tool Start: ${tool.id?.[tool.id.length - 1] || 'unknown'}`);
    }
  }
  
  async handleToolEnd(
    output: string,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    await this.ledger.logToolInvocation({
      toolName: 'langchain_tool',
      requestedBy: runInfo.parentRunId,
      inputHash: runInfo.promptHash!,
      outputHash: hashContent(output),
      durationMs: Date.now() - runInfo.startTime,
      success: true,
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] Tool End: ${runId}`);
    }
  }
  
  async handleToolError(
    err: Error,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    await this.ledger.logToolInvocation({
      toolName: 'langchain_tool',
      requestedBy: runInfo.parentRunId,
      inputHash: runInfo.promptHash || '',
      outputHash: '',
      durationMs: Date.now() - runInfo.startTime,
      success: false,
      error: {
        code: err.name || 'ERROR',
        message: err.message,
      },
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] Tool Error: ${runId} - ${err.message}`);
    }
  }
  
  // ============================================================================
  // AGENT CALLBACKS
  // ============================================================================
  
  async handleAgentAction(
    action: AgentAction,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    await this.ledger.logDecision({
      decisionId: `agent_action_${runId}`,
      category: 'tool_selection',
      optionsConsidered: [
        { option_id: action.tool, description: `Tool: ${action.tool}` },
      ],
      selectedOption: action.tool,
      reasoningHash: hashContent(action.log || ''),
    });
    
    if (this.verbose) {
      console.log(`[AgentLedger] Agent Action: ${action.tool}`);
    }
  }
  
  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    await this.ledger.logDecision({
      decisionId: `agent_finish_${runId}`,
      category: 'termination',
      optionsConsidered: [
        { option_id: 'finish', description: 'End agent execution' },
      ],
      selectedOption: 'finish',
      reasoningHash: hashContent(action.log || ''),
    });
    
    if (this.verbose) {
      console.log(`[AgentLedger] Agent End: ${runId}`);
    }
  }
  
  // ============================================================================
  // CHAIN CALLBACKS
  // ============================================================================
  
  async handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.runStack.set(runId, {
      runId,
      parentRunId,
      startTime: Date.now(),
      promptHash: hashContent(JSON.stringify(inputs)),
    });
    
    if (this.verbose) {
      console.log(`[AgentLedger] Chain Start: ${chain.id?.[chain.id.length - 1] || 'unknown'}`);
    }
  }
  
  async handleChainEnd(
    outputs: ChainValues,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    // Log as a state snapshot at chain completion
    await this.ledger.snapshot({
      trigger: 'checkpoint',
      stateHash: hashContent(JSON.stringify(outputs)),
      schemaVersion: '1.0.0',
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] Chain End: ${runId}`);
    }
  }
  
  async handleChainError(
    err: Error,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    await this.ledger.snapshot({
      trigger: 'error',
      stateHash: hashContent(JSON.stringify({ error: err.message })),
      schemaVersion: '1.0.0',
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] Chain Error: ${runId} - ${err.message}`);
    }
  }
  
  // ============================================================================
  // RETRIEVER CALLBACKS
  // ============================================================================
  
  async handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>
  ): Promise<void> {
    this.runStack.set(runId, {
      runId,
      parentRunId,
      startTime: Date.now(),
      promptHash: hashContent(query),
    });
    
    if (this.verbose) {
      console.log(`[AgentLedger] Retriever Start: ${query.substring(0, 50)}...`);
    }
  }
  
  async handleRetrieverEnd(
    documents: Document[],
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    await this.ledger.logToolInvocation({
      toolName: 'langchain_retriever',
      requestedBy: runInfo.parentRunId,
      inputHash: runInfo.promptHash!,
      outputHash: hashContent(JSON.stringify(documents.map(d => d.pageContent))),
      durationMs: Date.now() - runInfo.startTime,
      success: true,
      resourcesAccessed: documents.map(d => ({
        type: 'database' as const,
        identifier: d.metadata?.source || 'unknown',
        operation: 'read' as const,
      })),
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] Retriever End: ${documents.length} documents`);
    }
  }
  
  async handleRetrieverError(
    err: Error,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const runInfo = this.runStack.get(runId);
    if (!runInfo) return;
    
    await this.ledger.logToolInvocation({
      toolName: 'langchain_retriever',
      requestedBy: runInfo.parentRunId,
      inputHash: runInfo.promptHash || '',
      outputHash: '',
      durationMs: Date.now() - runInfo.startTime,
      success: false,
      error: {
        code: err.name || 'ERROR',
        message: err.message,
      },
    });
    
    this.runStack.delete(runId);
    
    if (this.verbose) {
      console.log(`[AgentLedger] Retriever Error: ${runId} - ${err.message}`);
    }
  }
  
  // ============================================================================
  // UTILITIES
  // ============================================================================
  
  private inferProvider(modelName: string): 'openai' | 'anthropic' | 'google' | 'azure' | 'bedrock' | 'custom' {
    const lower = modelName.toLowerCase();
    if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
    if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('gemini') || lower.includes('palm') || lower.includes('google')) return 'google';
    if (lower.includes('azure')) return 'azure';
    if (lower.includes('bedrock')) return 'bedrock';
    return 'custom';
  }
  
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }
  
  private estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    // Very rough cost estimates (prices change frequently)
    const costs: Record<string, { prompt: number; completion: number }> = {
      'gpt-4': { prompt: 0.03 / 1000, completion: 0.06 / 1000 },
      'gpt-4-turbo': { prompt: 0.01 / 1000, completion: 0.03 / 1000 },
      'gpt-3.5-turbo': { prompt: 0.0005 / 1000, completion: 0.0015 / 1000 },
      'claude-3-opus': { prompt: 0.015 / 1000, completion: 0.075 / 1000 },
      'claude-3-sonnet': { prompt: 0.003 / 1000, completion: 0.015 / 1000 },
      'claude-3-haiku': { prompt: 0.00025 / 1000, completion: 0.00125 / 1000 },
    };
    
    const lower = model.toLowerCase();
    for (const [key, value] of Object.entries(costs)) {
      if (lower.includes(key)) {
        return promptTokens * value.prompt + completionTokens * value.completion;
      }
    }
    
    // Default estimate
    return (promptTokens + completionTokens) * 0.002 / 1000;
  }
  
  private isRetryable(err: Error): boolean {
    const message = err.message.toLowerCase();
    return (
      message.includes('rate limit') ||
      message.includes('timeout') ||
      message.includes('503') ||
      message.includes('429')
    );
  }
}

// ============================================================================
// CONVENIENCE FUNCTION
// ============================================================================

/**
 * Create a LangChain callback handler for AgentLedger
 */
export function createLangChainHandler(
  ledger: Ledger,
  options?: { verbose?: boolean }
): AgentLedgerCallbackHandler {
  return new AgentLedgerCallbackHandler(ledger, options);
}
