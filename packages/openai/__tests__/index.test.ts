/**
 * Tests for @agentledger/openai package
 */

import { AuditedOpenAI, createAuditedOpenAI, audited, auditedChatCompletion } from '../src/index';
import { Ledger, hashContent } from 'agentledger-core';

// Mock OpenAI types for testing
interface MockChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface MockChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { content?: string };
    finish_reason: 'stop' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

function createMockCompletion(content: string = 'Hello, world!'): MockChatCompletion {
  return {
    id: 'chatcmpl-123',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  };
}

function createMockStream(content: string = 'Hello'): AsyncIterable<MockChatCompletionChunk> {
  const chunks: MockChatCompletionChunk[] = [
    {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4',
      choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    },
  ];

  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

function createMockOpenAIClient(options: {
  response?: MockChatCompletion;
  stream?: AsyncIterable<MockChatCompletionChunk>;
  error?: Error;
} = {}): any {
  return {
    chat: {
      completions: {
        create: jest.fn().mockImplementation(async (params: any) => {
          if (options.error) {
            throw options.error;
          }
          if (params.stream) {
            return options.stream || createMockStream();
          }
          return options.response || createMockCompletion();
        }),
      },
    },
  };
}

describe('AuditedOpenAI', () => {
  let ledger: Ledger;
  let mockClient: any;

  beforeEach(async () => {
    ledger = new Ledger({
      orgId: 'test-org',
      agentId: 'test-agent',
      environment: 'test',
      compliance: ['FINRA_4511'],
    });
    await ledger.start({ type: 'user', identifier: 'test-user' });
    mockClient = createMockOpenAIClient();
  });

  describe('constructor', () => {
    test('creates instance with required options', () => {
      const audited = new AuditedOpenAI(mockClient, { ledger });
      expect(audited).toBeInstanceOf(AuditedOpenAI);
    });

    test('provides access to raw client', () => {
      const audited = new AuditedOpenAI(mockClient, { ledger });
      expect(audited.raw).toBe(mockClient);
    });
  });

  describe('chat.completions.create', () => {
    describe('non-streaming', () => {
      test('logs successful completion', async () => {
        const audited = new AuditedOpenAI(mockClient, { ledger });

        const response = await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        expect(response).toBeDefined();
        expect((response as MockChatCompletion).choices[0].message.content).toBe('Hello, world!');

        const entries = await ledger.getEntries();
        expect(entries.length).toBe(1);

        const entry = entries[0]!.entry as any;
        expect(entry.type).toBe('model_call');
        expect(entry.provider).toBe('openai');
        expect(entry.model_id).toBe('gpt-4');
        expect(entry.prompt_tokens).toBe(10);
        expect(entry.completion_tokens).toBe(5);
        expect(entry.streamed).toBe(false);
      });

      test('logs with temperature parameter', async () => {
        const audited = new AuditedOpenAI(mockClient, { ledger });

        await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.7,
        });

        const entries = await ledger.getEntries();
        const entry = entries[0]!.entry as any;
        expect(entry.parameters.temperature).toBe(0.7);
      });

      test('logs with max_tokens parameter', async () => {
        const audited = new AuditedOpenAI(mockClient, { ledger });

        await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 100,
        });

        const entries = await ledger.getEntries();
        const entry = entries[0]!.entry as any;
        expect(entry.parameters.max_tokens).toBe(100);
      });

      test('handles stop sequences array', async () => {
        const audited = new AuditedOpenAI(mockClient, { ledger });

        await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          stop: ['stop1', 'stop2'],
        });

        const entries = await ledger.getEntries();
        const entry = entries[0]!.entry as any;
        expect(entry.parameters.stop_sequences).toEqual(['stop1', 'stop2']);
      });

      test('logs error on failure', async () => {
        const error = new Error('Rate limit exceeded');
        (error as any).code = '429';
        mockClient = createMockOpenAIClient({ error });

        const audited = new AuditedOpenAI(mockClient, { ledger });

        await expect(
          audited.chat.completions.create({
            model: 'gpt-4',
            messages: [{ role: 'user', content: 'Hello' }],
          })
        ).rejects.toThrow('Rate limit exceeded');

        const entries = await ledger.getEntries();
        expect(entries.length).toBe(1);

        const entry = entries[0]!.entry as any;
        expect(entry.type).toBe('model_call');
        expect(entry.error).toBeTruthy();
        expect(entry.error.message).toBe('Rate limit exceeded');
        expect(entry.error.retryable).toBe(true);
      });
    });

    describe('streaming', () => {
      test('logs streaming completion after stream ends', async () => {
        const audited = new AuditedOpenAI(mockClient, { ledger });

        const stream = await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        });

        // Consume the stream
        let fullContent = '';
        for await (const chunk of stream as AsyncIterable<MockChatCompletionChunk>) {
          fullContent += chunk.choices[0]?.delta?.content || '';
        }

        expect(fullContent).toBe('Hello');

        const entries = await ledger.getEntries();
        expect(entries.length).toBe(1);

        const entry = entries[0]!.entry as any;
        expect(entry.type).toBe('model_call');
        expect(entry.streamed).toBe(true);
        expect(entry.completion_hash).toBe(hashContent('Hello'));
      });

      test('logs error on stream failure', async () => {
        const error = new Error('Connection timeout');
        const failingStream = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              id: 'chatcmpl-123',
              object: 'chat.completion.chunk',
              created: Date.now(),
              model: 'gpt-4',
              choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }],
            };
            throw error;
          },
        };

        mockClient = createMockOpenAIClient({ stream: failingStream as any });
        const audited = new AuditedOpenAI(mockClient, { ledger });

        const stream = await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: true,
        });

        await expect(async () => {
          for await (const _chunk of stream as AsyncIterable<any>) {
            // consume
          }
        }).rejects.toThrow('Connection timeout');

        const entries = await ledger.getEntries();
        expect(entries.length).toBe(1);

        const entry = entries[0]!.entry as any;
        expect(entry.error).toBeTruthy();
        expect(entry.error.retryable).toBe(true);
      });
    });

    describe('content storage', () => {
      test('stores content when enabled', async () => {
        const audited = new AuditedOpenAI(mockClient, {
          ledger,
          storeContent: true
        });

        await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        const entries = await ledger.getEntries();
        // Model call + 2 content references (prompt + completion)
        expect(entries.length).toBe(3);

        const contentRefs = entries.filter(e => e.entry.type === 'content_reference');
        expect(contentRefs.length).toBe(2);

        const types = contentRefs.map(e => (e.entry as any).content_type);
        expect(types).toContain('prompt');
        expect(types).toContain('completion');
      });

      test('does not store content when disabled', async () => {
        const audited = new AuditedOpenAI(mockClient, {
          ledger,
          storeContent: false
        });

        await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        const entries = await ledger.getEntries();
        expect(entries.length).toBe(1);
        expect(entries[0]!.entry.type).toBe('model_call');
      });
    });

    describe('cost calculation', () => {
      test('calculates cost for gpt-4', async () => {
        mockClient = createMockOpenAIClient({
          response: {
            ...createMockCompletion(),
            usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
          },
        });

        const audited = new AuditedOpenAI(mockClient, { ledger });

        await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        const entries = await ledger.getEntries();
        const entry = entries[0]!.entry as any;
        expect(entry.cost_usd).toBeGreaterThan(0);
      });

      test('uses custom cost calculator', async () => {
        const customCalculator = jest.fn().mockReturnValue(0.05);

        const audited = new AuditedOpenAI(mockClient, {
          ledger,
          costCalculator: customCalculator,
        });

        await audited.chat.completions.create({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        });

        expect(customCalculator).toHaveBeenCalledWith('gpt-4', 10, 5);

        const entries = await ledger.getEntries();
        const entry = entries[0]!.entry as any;
        expect(entry.cost_usd).toBe(0.05);
      });
    });
  });
});

describe('audited decorator', () => {
  let ledger: Ledger;

  beforeEach(async () => {
    ledger = new Ledger({
      orgId: 'test-org',
      agentId: 'test-agent',
      environment: 'test',
      compliance: ['FINRA_4511'],
    });
    await ledger.start({ type: 'user', identifier: 'test-user' });
  });

  test('logs successful function execution', async () => {
    const myFunction = async (x: number, y: number) => x + y;
    const decorated = audited(ledger)(myFunction);

    const result = await decorated(2, 3);
    expect(result).toBe(5);

    const entries = await ledger.getEntries();
    expect(entries.length).toBe(1);

    const entry = entries[0]!.entry as any;
    expect(entry.type).toBe('tool_invocation');
    expect(entry.tool_name).toBe('myFunction');
    expect(entry.success).toBe(true);
    expect(entry.input_hash).toBe(hashContent(JSON.stringify([2, 3])));
    expect(entry.output_hash).toBe(hashContent(JSON.stringify(5)));
  });

  test('logs failed function execution', async () => {
    const failingFunction = async () => {
      throw new Error('Something went wrong');
    };
    const decorated = audited(ledger)(failingFunction);

    await expect(decorated()).rejects.toThrow('Something went wrong');

    const entries = await ledger.getEntries();
    expect(entries.length).toBe(1);

    const entry = entries[0]!.entry as any;
    expect(entry.type).toBe('tool_invocation');
    expect(entry.success).toBe(false);
    expect(entry.error.message).toBe('Something went wrong');
  });

  test('preserves function behavior', async () => {
    const complexFunction = async (data: { x: number; y: number }) => {
      return { sum: data.x + data.y, product: data.x * data.y };
    };
    const decorated = audited(ledger)(complexFunction);

    const result = await decorated({ x: 4, y: 5 });
    expect(result).toEqual({ sum: 9, product: 20 });
  });
});

describe('createAuditedOpenAI', () => {
  test('creates AuditedOpenAI instance', async () => {
    const ledger = new Ledger({
      orgId: 'test-org',
      agentId: 'test-agent',
      environment: 'test',
      compliance: ['FINRA_4511'],
    });
    await ledger.start({ type: 'user', identifier: 'test-user' });

    const mockClient = createMockOpenAIClient();
    const audited = createAuditedOpenAI(mockClient, { ledger });

    expect(audited).toBeInstanceOf(AuditedOpenAI);
  });
});

describe('auditedChatCompletion', () => {
  test('performs single audited completion', async () => {
    const ledger = new Ledger({
      orgId: 'test-org',
      agentId: 'test-agent',
      environment: 'test',
      compliance: ['FINRA_4511'],
    });
    await ledger.start({ type: 'user', identifier: 'test-user' });

    const mockClient = createMockOpenAIClient();

    const response = await auditedChatCompletion(mockClient, ledger, {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(response.choices[0].message.content).toBe('Hello, world!');

    const entries = await ledger.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0]!.entry.type).toBe('model_call');
  });
});
