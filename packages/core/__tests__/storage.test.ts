/**
 * Comprehensive tests for AgentLedger storage backends
 */

import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { InMemoryStorage, FileSystemStorage } from '../src/storage';
import { generateId, timestamp, hashContent, verifyChain, generateKeyPair } from '../src/crypto';
import type { ModelCall, SessionEnvelope, ToolInvocation, DecisionPoint } from '../src/types';

// Helper to create a valid session envelope
function createSessionEnvelope(overrides: Partial<SessionEnvelope> = {}): SessionEnvelope {
  return {
    session_id: generateId(),
    org_id: 'test-org',
    agent_id: 'test-agent',
    agent_version: '1.0.0',
    environment: 'test',
    initiated_by: {
      type: 'user',
      identifier: 'test-user',
    },
    initiated_at: timestamp(),
    compliance_contexts: ['FINRA_4511'],
    retention_days: 2555,
    ...overrides,
  };
}

// Helper to create a model call entry
function createModelCallEntry(overrides: Partial<ModelCall> = {}): ModelCall {
  return {
    type: 'model_call',
    entry_id: generateId(),
    timestamp: timestamp(),
    provider: 'openai',
    model_id: 'gpt-4',
    parameters: { temperature: 0.7 },
    prompt_hash: hashContent('test prompt'),
    prompt_tokens: 100,
    completion_hash: hashContent('test response'),
    completion_tokens: 50,
    latency_ms: 500,
    streamed: false,
    ...overrides,
  };
}

// Helper to create a tool invocation entry
function createToolInvocationEntry(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    type: 'tool_invocation',
    entry_id: generateId(),
    timestamp: timestamp(),
    tool_name: 'test-tool',
    input_hash: hashContent('input'),
    output_hash: hashContent('output'),
    duration_ms: 100,
    success: true,
    ...overrides,
  };
}

// Helper to create a decision point entry
function createDecisionPointEntry(overrides: Partial<DecisionPoint> = {}): DecisionPoint {
  return {
    type: 'decision_point',
    entry_id: generateId(),
    timestamp: timestamp(),
    decision_id: 'decision-1',
    category: 'routing',
    options_considered: [
      { option_id: 'opt1', description: 'Option 1', score: 0.8 },
      { option_id: 'opt2', description: 'Option 2', score: 0.6 },
    ],
    selected_option: 'opt1',
    reasoning_hash: hashContent('reasoning'),
    human_review_required: false,
    ...overrides,
  };
}

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;
  let session: SessionEnvelope;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    session = createSessionEnvelope();
    await storage.initialize(session);
  });

  describe('initialize', () => {
    test('initializes with session', async () => {
      const newStorage = new InMemoryStorage();
      const newSession = createSessionEnvelope();

      await newStorage.initialize(newSession);

      expect(newStorage.getSession()).toEqual(newSession);
    });

    test('resets entries on re-initialize', async () => {
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());

      expect(await storage.count()).toBe(2);

      // Re-initialize
      await storage.initialize(createSessionEnvelope());

      expect(await storage.count()).toBe(0);
    });
  });

  describe('append', () => {
    test('appends single entry', async () => {
      const entry = createModelCallEntry();
      const chained = await storage.append(entry);

      expect(chained.sequence).toBe(0);
      expect(chained.entry).toEqual(entry);
      expect(chained.previous_hash).toBe('');
      expect(chained.entry_hash).toHaveLength(64);
    });

    test('appends multiple entries with correct chaining', async () => {
      const entry1 = createModelCallEntry({ prompt_tokens: 100 });
      const entry2 = createModelCallEntry({ prompt_tokens: 200 });
      const entry3 = createModelCallEntry({ prompt_tokens: 300 });

      const chained1 = await storage.append(entry1);
      const chained2 = await storage.append(entry2);
      const chained3 = await storage.append(entry3);

      expect(chained1.sequence).toBe(0);
      expect(chained2.sequence).toBe(1);
      expect(chained3.sequence).toBe(2);

      expect(chained2.previous_hash).toBe(chained1.entry_hash);
      expect(chained3.previous_hash).toBe(chained2.entry_hash);
    });

    test('appends different entry types', async () => {
      const modelCall = createModelCallEntry();
      const toolInvocation = createToolInvocationEntry();
      const decisionPoint = createDecisionPointEntry();

      await storage.append(modelCall);
      await storage.append(toolInvocation);
      await storage.append(decisionPoint);

      expect(await storage.count()).toBe(3);

      const all = await storage.getAll();
      expect(all[0]!.entry.type).toBe('model_call');
      expect(all[1]!.entry.type).toBe('tool_invocation');
      expect(all[2]!.entry.type).toBe('decision_point');
    });
  });

  describe('getRange', () => {
    beforeEach(async () => {
      for (let i = 0; i < 10; i++) {
        await storage.append(createModelCallEntry({ prompt_tokens: i * 10 }));
      }
    });

    test('gets specified range', async () => {
      const range = await storage.getRange(2, 5);
      expect(range).toHaveLength(3);
      expect(range[0]!.sequence).toBe(2);
      expect(range[2]!.sequence).toBe(4);
    });

    test('handles start at 0', async () => {
      const range = await storage.getRange(0, 3);
      expect(range).toHaveLength(3);
      expect(range[0]!.sequence).toBe(0);
    });

    test('handles range beyond entries', async () => {
      const range = await storage.getRange(8, 20);
      expect(range).toHaveLength(2);
    });

    test('returns empty for out of range', async () => {
      const range = await storage.getRange(20, 30);
      expect(range).toHaveLength(0);
    });
  });

  describe('getAll', () => {
    test('returns empty array initially', async () => {
      const all = await storage.getAll();
      expect(all).toHaveLength(0);
    });

    test('returns all entries', async () => {
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());

      const all = await storage.getAll();
      expect(all).toHaveLength(3);
    });

    test('returns copy (not reference)', async () => {
      await storage.append(createModelCallEntry());
      const all1 = await storage.getAll();
      const all2 = await storage.getAll();

      expect(all1).toEqual(all2);
      expect(all1).not.toBe(all2);
    });
  });

  describe('count', () => {
    test('returns 0 initially', async () => {
      expect(await storage.count()).toBe(0);
    });

    test('returns correct count after appends', async () => {
      await storage.append(createModelCallEntry());
      expect(await storage.count()).toBe(1);

      await storage.append(createModelCallEntry());
      expect(await storage.count()).toBe(2);
    });
  });

  describe('verify', () => {
    test('verifies empty chain', async () => {
      const result = await storage.verify();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('verifies valid chain', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.append(createModelCallEntry({ prompt_tokens: i * 10 }));
      }

      const result = await storage.verify();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('close', () => {
    test('closes session without signing', async () => {
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());

      const log = await storage.close();

      expect(log.version).toBe('1.0.0');
      expect(log.session.closed_at).toBeTruthy();
      expect(log.entries).toHaveLength(2);
      expect(log.merkle_root).toHaveLength(64);
      expect(log.org_signature).toBeUndefined();
      expect(log.integrity?.chain_valid).toBe(true);
      expect(log.integrity?.merkle_valid).toBe(true);
    });

    test('closes session with signing', async () => {
      const { publicKey, privateKey } = generateKeyPair();

      await storage.append(createModelCallEntry());

      const log = await storage.close(privateKey, publicKey);

      expect(log.org_signature).toBeTruthy();
      expect(log.org_signature?.public_key).toBe(publicKey);
      expect(log.org_signature?.signature).toBeTruthy();
      expect(log.integrity?.signature_valid).toBe(true);
    });

    test('closed log can be verified', async () => {
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());

      const log = await storage.close();

      // Verify chain externally
      const chainResult = verifyChain(log.entries);
      expect(chainResult.valid).toBe(true);
    });
  });

  describe('export', () => {
    beforeEach(async () => {
      await storage.append(createModelCallEntry());
      await storage.append(createToolInvocationEntry());
    });

    test('exports to jsonl format', async () => {
      const buffer = await storage.export({ format: 'jsonl' });
      const content = buffer.toString();
      const lines = content.split('\n');

      expect(lines.length).toBeGreaterThan(0);
      // Each line should be valid JSON
      for (const line of lines) {
        if (line.trim()) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      }
    });

    test('exports to splunk_cim format', async () => {
      const buffer = await storage.export({ format: 'splunk_cim' });
      const content = buffer.toString();
      const lines = content.split('\n');

      for (const line of lines) {
        if (line.trim()) {
          const event = JSON.parse(line);
          expect(event).toHaveProperty('time');
          expect(event).toHaveProperty('host');
          expect(event).toHaveProperty('source', 'agentledger');
        }
      }
    });

    test('exports to elastic_ecs format', async () => {
      const buffer = await storage.export({ format: 'elastic_ecs' });
      const content = buffer.toString();
      const lines = content.split('\n');

      for (const line of lines) {
        if (line.trim()) {
          const doc = JSON.parse(line);
          expect(doc).toHaveProperty('@timestamp');
          expect(doc['ecs.version']).toBe('8.0.0');
        }
      }
    });

    test('exports to finra_4511 format', async () => {
      const buffer = await storage.export({ format: 'finra_4511' });
      const record = JSON.parse(buffer.toString());

      expect(record.record_type).toBe('AI_AGENT_AUDIT_LOG');
      expect(record.finra_rule).toBe('4511');
      expect(record.records).toBeInstanceOf(Array);
    });

    test('exports to eu_ai_act format', async () => {
      const buffer = await storage.export({ format: 'eu_ai_act' });
      const record = JSON.parse(buffer.toString());

      expect(record.regulation).toBe('EU_AI_ACT');
      expect(record.article).toBe('12');
      expect(record.events).toBeInstanceOf(Array);
    });
  });

  describe('content storage', () => {
    test('stores and retrieves content', () => {
      const content = Buffer.from('test content');
      const hash = hashContent(content);

      storage.storeContent(hash, content);
      const retrieved = storage.getContent(hash);

      expect(retrieved).toEqual(content);
    });

    test('returns undefined for missing content', () => {
      const retrieved = storage.getContent('nonexistent-hash');
      expect(retrieved).toBeUndefined();
    });
  });
});

describe('FileSystemStorage', () => {
  const testBasePath = join(__dirname, '../.test-storage');
  let storage: FileSystemStorage;
  let session: SessionEnvelope;

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(testBasePath)) {
      rmSync(testBasePath, { recursive: true });
    }
    mkdirSync(testBasePath, { recursive: true });

    storage = new FileSystemStorage(testBasePath);
    session = createSessionEnvelope();
    await storage.initialize(session);
  });

  afterEach(() => {
    // Clean up
    if (existsSync(testBasePath)) {
      rmSync(testBasePath, { recursive: true });
    }
  });

  describe('initialize', () => {
    test('creates directory structure', async () => {
      const newSession = createSessionEnvelope();
      const newStorage = new FileSystemStorage(testBasePath);
      await newStorage.initialize(newSession);

      const sessionDir = join(testBasePath, newSession.org_id, newSession.session_id);
      expect(existsSync(sessionDir)).toBe(true);
      expect(existsSync(join(sessionDir, 'audit.jsonl'))).toBe(true);
    });

    test('writes session header', async () => {
      const sessionDir = join(testBasePath, session.org_id, session.session_id);
      const content = readFileSync(join(sessionDir, 'audit.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(1);
      const header = JSON.parse(lines[0]!);
      expect(header.type).toBe('session');
      expect(header.data.session_id).toBe(session.session_id);
    });
  });

  describe('append', () => {
    test('appends entries to file', async () => {
      const entry = createModelCallEntry();
      await storage.append(entry);

      const sessionDir = join(testBasePath, session.org_id, session.session_id);
      const content = readFileSync(join(sessionDir, 'audit.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2); // session header + 1 entry
    });

    test('maintains correct chain across appends', async () => {
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());

      const result = await storage.verify();
      expect(result.valid).toBe(true);
    });
  });

  describe('getAll', () => {
    test('retrieves all entries from file', async () => {
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());
      await storage.append(createModelCallEntry());

      const all = await storage.getAll();
      expect(all).toHaveLength(3);
    });
  });

  describe('close', () => {
    test('writes final log file', async () => {
      await storage.append(createModelCallEntry());

      const log = await storage.close();

      const sessionDir = join(testBasePath, session.org_id, session.session_id);
      const finalPath = join(sessionDir, 'audit.final.json');

      expect(existsSync(finalPath)).toBe(true);

      const content = readFileSync(finalPath, 'utf-8');
      const parsedLog = JSON.parse(content);

      expect(parsedLog.version).toBe('1.0.0');
      expect(parsedLog.entries).toHaveLength(1);
    });
  });

  describe('append/verify/close cycle', () => {
    test('complete lifecycle', async () => {
      // Append entries
      for (let i = 0; i < 10; i++) {
        await storage.append(createModelCallEntry({ prompt_tokens: i * 10 }));
      }

      // Verify
      const verifyResult = await storage.verify();
      expect(verifyResult.valid).toBe(true);

      // Close
      const log = await storage.close();
      expect(log.entries).toHaveLength(10);
      expect(log.integrity?.chain_valid).toBe(true);
    });
  });
});
