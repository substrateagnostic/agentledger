/**
 * @agentledger/openai
 * OpenAI SDK integration for AgentLedger
 * 
 * Provides wrappers and decorators for automatic audit logging of OpenAI API calls.
 */

import type OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming, ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions';
import type { Stream } from 'openai/streaming';

import { Ledger, hashContent } from 'agentledger-core';

// ============================================================================
// TYPES
// ============================================================================

type ChatCompletionCreateParams = ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming;

interface AuditedOpenAIOptions {
  /** The ledger instance to log to */
  ledger: Ledger;
  
  /** Whether to store full prompts/completions (default: false, only hashes) */
  storeContent?: boolean;
  
  /** Custom cost calculator (override default estimates) */
  costCalculator?: (model: string, promptTokens: number, completionTokens: number) => number;
}

// ============================================================================
// WRAPPER CLASS
// ============================================================================

/**
 * Wraps an OpenAI client to automatically log all chat completions to AgentLedger
 */
export class AuditedOpenAI {
  private client: OpenAI;
  private ledger: Ledger;
  private storeContent: boolean;
  private costCalculator?: (model: string, promptTokens: number, completionTokens: number) => number;
  
  constructor(client: OpenAI, options: AuditedOpenAIOptions) {
    this.client = client;
    this.ledger = options.ledger;
    this.storeContent = options.storeContent ?? false;
    this.costCalculator = options.costCalculator;
  }
  
  /**
   * Proxied chat.completions.create with automatic audit logging
   */
  get chat() {
    const self = this;
    return {
      completions: {
        async create(params: ChatCompletionCreateParams): Promise<ChatCompletion | Stream<ChatCompletionChunk>> {
          const startTime = Date.now();
          const promptText = JSON.stringify(params.messages);
          const promptHash = hashContent(promptText);
          
          try {
            if (params.stream) {
              // Handle streaming response
              const stream = await self.client.chat.completions.create(params as ChatCompletionCreateParamsStreaming);
              return self.wrapStream(stream, params, promptHash, startTime);
            } else {
              // Handle non-streaming response
              const response = await self.client.chat.completions.create(params as ChatCompletionCreateParamsNonStreaming);
              await self.logCompletion(params, response, promptHash, startTime);
              return response;
            }
          } catch (error) {
            await self.logError(params, error as Error, promptHash, startTime);
            throw error;
          }
        },
      },
    };
  }
  
  /**
   * Direct access to underlying client for non-audited operations
   */
  get raw(): OpenAI {
    return this.client;
  }
  
  private async logCompletion(
    params: ChatCompletionCreateParams,
    response: ChatCompletion,
    promptHash: string,
    startTime: number
  ): Promise<void> {
    const completionText = response.choices
      .map(c => c.message?.content || '')
      .join('\n');
    
    const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0 };
    
    const entry = await this.ledger.logModelCall({
      provider: 'openai',
      modelId: params.model,
      parameters: {
        temperature: params.temperature ?? undefined,
        top_p: params.top_p ?? undefined,
        max_tokens: params.max_tokens ?? undefined,
        stop_sequences: Array.isArray(params.stop) ? params.stop : params.stop ? [params.stop] : undefined,
      },
      promptHash,
      promptTokens: usage.prompt_tokens,
      completionHash: hashContent(completionText),
      completionTokens: usage.completion_tokens,
      latencyMs: Date.now() - startTime,
      costUsd: this.calculateCost(params.model, usage.prompt_tokens, usage.completion_tokens),
      streamed: false,
    });
    
    // Store content if configured
    if (this.storeContent) {
      await this.ledger.storeContent({
        contentType: 'prompt',
        parentEntryId: entry.entry.entry_id,
        content: JSON.stringify(params.messages),
      });
      
      await this.ledger.storeContent({
        contentType: 'completion',
        parentEntryId: entry.entry.entry_id,
        content: completionText,
      });
    }
  }
  
  private wrapStream(
    stream: Stream<ChatCompletionChunk>,
    params: ChatCompletionCreateParams,
    promptHash: string,
    startTime: number
  ): Stream<ChatCompletionChunk> {
    const self = this;
    let fullContent = '';
    let promptTokens = 0;
    let completionTokens = 0;
    
    // Create a proxy that intercepts the async iterator
    const originalIterator = stream[Symbol.asyncIterator].bind(stream);
    
    const wrappedIterator = async function* () {
      try {
        for await (const chunk of { [Symbol.asyncIterator]: originalIterator }) {
          // Accumulate content
          const delta = chunk.choices[0]?.delta?.content || '';
          fullContent += delta;
          
          // Track usage if provided
          if (chunk.usage) {
            promptTokens = chunk.usage.prompt_tokens || promptTokens;
            completionTokens = chunk.usage.completion_tokens || completionTokens;
          }
          
          yield chunk;
        }
        
        // Log after stream completes
        await self.ledger.logModelCall({
          provider: 'openai',
          modelId: params.model,
          parameters: {
            temperature: params.temperature ?? undefined,
            top_p: params.top_p ?? undefined,
            max_tokens: params.max_tokens ?? undefined,
          },
          promptHash,
          promptTokens: promptTokens || self.estimateTokens(JSON.stringify(params.messages)),
          completionHash: hashContent(fullContent),
          completionTokens: completionTokens || self.estimateTokens(fullContent),
          latencyMs: Date.now() - startTime,
          costUsd: self.calculateCost(params.model, promptTokens, completionTokens),
          streamed: true,
        });
      } catch (error) {
        await self.logError(params, error as Error, promptHash, startTime);
        throw error;
      }
    };
    
    // Return a new object that looks like a Stream but uses our wrapped iterator
    return {
      ...stream,
      [Symbol.asyncIterator]: wrappedIterator,
    } as unknown as Stream<ChatCompletionChunk>;
  }
  
  private async logError(
    params: ChatCompletionCreateParams,
    error: Error,
    promptHash: string,
    startTime: number
  ): Promise<void> {
    await this.ledger.logModelCall({
      provider: 'openai',
      modelId: params.model,
      parameters: {
        temperature: params.temperature ?? undefined,
        top_p: params.top_p ?? undefined,
        max_tokens: params.max_tokens ?? undefined,
      },
      promptHash,
      promptTokens: 0,
      completionHash: '',
      completionTokens: 0,
      latencyMs: Date.now() - startTime,
      error: {
        code: (error as { code?: string }).code || error.name || 'ERROR',
        message: error.message,
        retryable: this.isRetryable(error),
      },
    });
  }
  
  private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
    if (this.costCalculator) {
      return this.costCalculator(model, promptTokens, completionTokens);
    }
    
    // Default OpenAI pricing (as of late 2024, update as needed)
    const pricing: Record<string, { prompt: number; completion: number }> = {
      'gpt-4o': { prompt: 2.50 / 1_000_000, completion: 10.00 / 1_000_000 },
      'gpt-4o-mini': { prompt: 0.15 / 1_000_000, completion: 0.60 / 1_000_000 },
      'gpt-4-turbo': { prompt: 10.00 / 1_000_000, completion: 30.00 / 1_000_000 },
      'gpt-4': { prompt: 30.00 / 1_000_000, completion: 60.00 / 1_000_000 },
      'gpt-3.5-turbo': { prompt: 0.50 / 1_000_000, completion: 1.50 / 1_000_000 },
      'o1-preview': { prompt: 15.00 / 1_000_000, completion: 60.00 / 1_000_000 },
      'o1-mini': { prompt: 3.00 / 1_000_000, completion: 12.00 / 1_000_000 },
    };
    
    for (const [key, value] of Object.entries(pricing)) {
      if (model.includes(key)) {
        return promptTokens * value.prompt + completionTokens * value.completion;
      }
    }
    
    // Fallback estimate
    return (promptTokens + completionTokens) * 0.002 / 1000;
  }
  
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  
  private isRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();
    const code = (error as { code?: string }).code;
    return (
      message.includes('rate limit') ||
      message.includes('timeout') ||
      code === '429' ||
      code === '503'
    );
  }
}

// ============================================================================
// DECORATOR FUNCTION
// ============================================================================

/**
 * Decorator to audit a function that uses OpenAI
 */
export function audited(ledger: Ledger) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    target: T,
    context?: ClassMethodDecoratorContext
  ): T {
    const wrapped = async function (this: unknown, ...args: unknown[]) {
      const startTime = Date.now();
      const functionName = context?.name?.toString() || target.name || 'anonymous';
      
      try {
        const result = await target.apply(this, args);
        
        // Log successful execution
        await ledger.logToolInvocation({
          toolName: functionName,
          inputHash: hashContent(JSON.stringify(args)),
          outputHash: hashContent(JSON.stringify(result)),
          durationMs: Date.now() - startTime,
          success: true,
        });
        
        return result;
      } catch (error) {
        // Log failed execution
        await ledger.logToolInvocation({
          toolName: functionName,
          inputHash: hashContent(JSON.stringify(args)),
          outputHash: '',
          durationMs: Date.now() - startTime,
          success: false,
          error: {
            code: (error as Error).name || 'ERROR',
            message: (error as Error).message,
          },
        });
        
        throw error;
      }
    } as T;
    
    return wrapped;
  };
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create an audited OpenAI client
 */
export function createAuditedOpenAI(
  client: OpenAI,
  options: AuditedOpenAIOptions
): AuditedOpenAI {
  return new AuditedOpenAI(client, options);
}

/**
 * Wrap a single chat completion call with audit logging
 */
export async function auditedChatCompletion(
  client: OpenAI,
  ledger: Ledger,
  params: ChatCompletionCreateParamsNonStreaming
): Promise<ChatCompletion> {
  const audited = new AuditedOpenAI(client, { ledger });
  return audited.chat.completions.create(params) as Promise<ChatCompletion>;
}
