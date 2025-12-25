/**
 * @agentledger/anthropic
 * Anthropic SDK integration for AgentLedger
 *
 * Provides wrappers and decorators for automatic audit logging of Anthropic API calls.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type {
  MessageCreateParams,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
  Message,
  RawMessageStreamEvent
} from '@anthropic-ai/sdk/resources/messages';
import type { Stream } from '@anthropic-ai/sdk/streaming';

import { Ledger, hashContent } from 'agentledger-core';

// ============================================================================
// TYPES
// ============================================================================

interface AuditedAnthropicOptions {
  /** The ledger instance to log to */
  ledger: Ledger;

  /** Whether to store full prompts/completions (default: false, only hashes) */
  storeContent?: boolean;

  /** Custom cost calculator (override default estimates) */
  costCalculator?: (model: string, inputTokens: number, outputTokens: number) => number;
}

// ============================================================================
// WRAPPER CLASS
// ============================================================================

/**
 * Wraps an Anthropic client to automatically log all messages to AgentLedger
 */
export class AuditedAnthropic {
  private client: Anthropic;
  private ledger: Ledger;
  private storeContent: boolean;
  private costCalculator?: (model: string, inputTokens: number, outputTokens: number) => number;

  constructor(client: Anthropic, options: AuditedAnthropicOptions) {
    this.client = client;
    this.ledger = options.ledger;
    this.storeContent = options.storeContent ?? false;
    this.costCalculator = options.costCalculator;
  }

  /**
   * Proxied messages.create with automatic audit logging
   */
  get messages() {
    const self = this;
    return {
      async create(params: MessageCreateParams): Promise<Message | Stream<RawMessageStreamEvent>> {
        const startTime = Date.now();
        const promptText = JSON.stringify(params.messages);
        const promptHash = hashContent(promptText);
        const systemHash = params.system ? hashContent(
          typeof params.system === 'string' ? params.system : JSON.stringify(params.system)
        ) : undefined;

        try {
          if ('stream' in params && params.stream === true) {
            // Handle streaming response
            const stream = await self.client.messages.create(params as MessageCreateParamsStreaming);
            return self.wrapStream(stream, params, promptHash, systemHash, startTime);
          } else {
            // Handle non-streaming response
            const response = await self.client.messages.create(params as MessageCreateParamsNonStreaming);
            await self.logMessage(params, response, promptHash, systemHash, startTime);
            return response;
          }
        } catch (error) {
          await self.logError(params, error as Error, promptHash, systemHash, startTime);
          throw error;
        }
      },
    };
  }

  /**
   * Direct access to underlying client for non-audited operations
   */
  get raw(): Anthropic {
    return this.client;
  }

  private async logMessage(
    params: MessageCreateParams,
    response: Message,
    promptHash: string,
    systemHash: string | undefined,
    startTime: number
  ): Promise<void> {
    const completionText = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n');

    const entry = await this.ledger.logModelCall({
      provider: 'anthropic',
      modelId: params.model,
      parameters: {
        temperature: params.temperature,
        top_p: params.top_p,
        top_k: params.top_k,
        max_tokens: params.max_tokens,
        system_prompt_hash: systemHash,
      },
      promptHash,
      promptTokens: response.usage.input_tokens,
      completionHash: hashContent(completionText),
      completionTokens: response.usage.output_tokens,
      latencyMs: Date.now() - startTime,
      costUsd: this.calculateCost(params.model, response.usage.input_tokens, response.usage.output_tokens),
      streamed: false,
    });

    // Log tool use if present
    const toolUseBlocks = response.content.filter(block => block.type === 'tool_use');
    for (const block of toolUseBlocks) {
      if (block.type === 'tool_use') {
        await this.ledger.logToolInvocation({
          toolName: block.name,
          requestedBy: entry.entry.entry_id,
          inputHash: hashContent(JSON.stringify(block.input)),
          outputHash: '', // Output comes from tool_result in next message
          durationMs: 0,
          success: true,
        });
      }
    }

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
    stream: Stream<RawMessageStreamEvent>,
    params: MessageCreateParams,
    promptHash: string,
    systemHash: string | undefined,
    startTime: number
  ): Stream<RawMessageStreamEvent> {
    const self = this;
    let fullContent = '';
    let inputTokens = 0;
    let outputTokens = 0;

    const originalIterator = stream[Symbol.asyncIterator].bind(stream);

    const wrappedIterator = async function* () {
      try {
        for await (const event of { [Symbol.asyncIterator]: originalIterator }) {
          // Handle different event types
          if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              fullContent += delta.text;
            }
          } else if (event.type === 'message_delta') {
            if (event.usage) {
              outputTokens = event.usage.output_tokens;
            }
          } else if (event.type === 'message_start') {
            if (event.message?.usage) {
              inputTokens = event.message.usage.input_tokens;
            }
          }

          yield event;
        }

        // Log after stream completes
        await self.ledger.logModelCall({
          provider: 'anthropic',
          modelId: params.model,
          parameters: {
            temperature: params.temperature,
            top_p: params.top_p,
            top_k: params.top_k,
            max_tokens: params.max_tokens,
            system_prompt_hash: systemHash,
          },
          promptHash,
          promptTokens: inputTokens || self.estimateTokens(JSON.stringify(params.messages)),
          completionHash: hashContent(fullContent),
          completionTokens: outputTokens || self.estimateTokens(fullContent),
          latencyMs: Date.now() - startTime,
          costUsd: self.calculateCost(params.model, inputTokens, outputTokens),
          streamed: true,
        });
      } catch (error) {
        await self.logError(params, error as Error, promptHash, systemHash, startTime);
        throw error;
      }
    };

    // Create a proxy that wraps the original stream with our logging iterator
    return {
      ...stream,
      [Symbol.asyncIterator]: wrappedIterator,
    } as unknown as Stream<RawMessageStreamEvent>;
  }

  private async logError(
    params: MessageCreateParams,
    error: Error,
    promptHash: string,
    systemHash: string | undefined,
    startTime: number
  ): Promise<void> {
    await this.ledger.logModelCall({
      provider: 'anthropic',
      modelId: params.model,
      parameters: {
        temperature: params.temperature,
        top_p: params.top_p,
        top_k: params.top_k,
        max_tokens: params.max_tokens,
        system_prompt_hash: systemHash,
      },
      promptHash,
      promptTokens: 0,
      completionHash: '',
      completionTokens: 0,
      latencyMs: Date.now() - startTime,
      error: {
        code: (error as { status?: number }).status?.toString() || error.name || 'ERROR',
        message: error.message,
        retryable: this.isRetryable(error),
      },
    });
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    if (this.costCalculator) {
      return this.costCalculator(model, inputTokens, outputTokens);
    }

    // Anthropic pricing (as of late 2024, update as needed)
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-3-5-sonnet': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
      'claude-3-opus': { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
      'claude-3-sonnet': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
      'claude-3-haiku': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },
      'claude-2': { input: 8.00 / 1_000_000, output: 24.00 / 1_000_000 },
    };

    for (const [key, value] of Object.entries(pricing)) {
      if (model.includes(key)) {
        return inputTokens * value.input + outputTokens * value.output;
      }
    }

    // Fallback estimate
    return (inputTokens + outputTokens) * 0.003 / 1000;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private isRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();
    const status = (error as { status?: number }).status;
    return (
      message.includes('rate limit') ||
      message.includes('overloaded') ||
      status === 429 ||
      status === 529 ||
      status === 503
    );
  }
}

// ============================================================================
// TOOL USE HELPERS
// ============================================================================

/**
 * Log a tool result back to the ledger
 */
export async function logToolResult(
  ledger: Ledger,
  toolUseId: string,
  toolName: string,
  result: unknown,
  success: boolean,
  error?: { code: string; message: string }
): Promise<void> {
  await ledger.logToolInvocation({
    toolName,
    requestedBy: toolUseId,
    inputHash: toolUseId, // Reference to the original tool_use block
    outputHash: hashContent(JSON.stringify(result)),
    durationMs: 0, // Tool execution time should be tracked externally
    success,
    error,
  });
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create an audited Anthropic client
 */
export function createAuditedAnthropic(
  client: Anthropic,
  options: AuditedAnthropicOptions
): AuditedAnthropic {
  return new AuditedAnthropic(client, options);
}

/**
 * Wrap a single message call with audit logging
 */
export async function auditedMessage(
  client: Anthropic,
  ledger: Ledger,
  params: MessageCreateParamsNonStreaming
): Promise<Message> {
  const audited = new AuditedAnthropic(client, { ledger });
  return audited.messages.create(params) as Promise<Message>;
}
