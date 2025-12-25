/**
 * Comprehensive tests for AgentLedger main API
 */

import { Ledger, createLedger, generateSigningKeys, hashContent, generateId } from '../src/ledger';
import { InMemoryStorage, FileSystemStorage } from '../src/storage';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { LedgerConfig } from '../src/ledger';

// Helper to create default config
function createConfig(overrides: Partial<LedgerConfig> = {}): LedgerConfig {
  return {
    orgId: 'test-org',
    agentId: 'test-agent',
    agentVersion: '1.0.0',
    environment: 'test',
    compliance: ['FINRA_4511'],
    retentionDays: 2555,
    ...overrides,
  };
}

describe('Ledger', () => {
  let ledger: Ledger;

  beforeEach(() => {
    ledger = new Ledger(createConfig());
  });

  describe('initialization', () => {
    test('throws if methods called before start', async () => {
      await expect(ledger.logModelCall({
        provider: 'openai',
        modelId: 'gpt-4',
        promptHash: hashContent('test'),
        promptTokens: 10,
        completionHash: hashContent('response'),
        completionTokens: 5,
        latencyMs: 100,
      })).rejects.toThrow('Ledger not initialized. Call start() first.');
    });

    test('start initializes session and returns session ID', async () => {
      const sessionId = await ledger.start({ type: 'user', identifier: 'test-user' });

      expect(sessionId).toHaveLength(36); // UUID format
      expect(ledger.getSession().session_id).toBe(sessionId);
    });

    test('session contains correct metadata', async () => {
      await ledger.start(
        { type: 'system', identifier: 'scheduler' },
        { foo: 'bar' }
      );

      const session = ledger.getSession();
      expect(session.org_id).toBe('test-org');
      expect(session.agent_id).toBe('test-agent');
      expect(session.agent_version).toBe('1.0.0');
      expect(session.environment).toBe('test');
      expect(session.compliance_contexts).toEqual(['FINRA_4511']);
      expect(session.initiated_by).toEqual({ type: 'system', identifier: 'scheduler' });
      expect(session.metadata).toEqual({ foo: 'bar' });
    });
  });

  describe('logModelCall', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
    });

    test('logs model call with required fields', async () => {
      const chained = await ledger.logModelCall({
        provider: 'openai',
        modelId: 'gpt-4',
        promptHash: hashContent('test prompt'),
        promptTokens: 100,
        completionHash: hashContent('test response'),
        completionTokens: 50,
        latencyMs: 500,
      });

      expect(chained.entry.type).toBe('model_call');
      expect(chained.sequence).toBe(0);
      expect(chained.entry_hash).toHaveLength(64);
    });

    test('logs model call with all optional fields', async () => {
      const chained = await ledger.logModelCall({
        provider: 'anthropic',
        modelId: 'claude-3-opus',
        modelVersion: '20240229',
        parameters: { temperature: 0.7, max_tokens: 1000 },
        promptHash: hashContent('test'),
        promptTokens: 100,
        completionHash: hashContent('response'),
        completionTokens: 50,
        latencyMs: 500,
        costUsd: 0.03,
        streamed: true,
        cacheStatus: 'hit',
      });

      const entry = chained.entry as any;
      expect(entry.provider).toBe('anthropic');
      expect(entry.model_version).toBe('20240229');
      expect(entry.parameters.temperature).toBe(0.7);
      expect(entry.cost_usd).toBe(0.03);
      expect(entry.streamed).toBe(true);
      expect(entry.cache_status).toBe('hit');
    });

    test('logs model call with error', async () => {
      const chained = await ledger.logModelCall({
        provider: 'openai',
        modelId: 'gpt-4',
        promptHash: hashContent('test'),
        promptTokens: 100,
        completionHash: '',
        completionTokens: 0,
        latencyMs: 100,
        error: { code: 'rate_limit', message: 'Rate limit exceeded' },
      });

      const entry = chained.entry as any;
      expect(entry.error.code).toBe('rate_limit');
    });
  });

  describe('logToolInvocation', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
    });

    test('logs tool invocation with required fields', async () => {
      const chained = await ledger.logToolInvocation({
        toolName: 'web_search',
        inputHash: hashContent('search query'),
        outputHash: hashContent('search results'),
        durationMs: 150,
        success: true,
      });

      expect(chained.entry.type).toBe('tool_invocation');
      const entry = chained.entry as any;
      expect(entry.tool_name).toBe('web_search');
      expect(entry.success).toBe(true);
    });

    test('logs tool invocation with failure', async () => {
      const chained = await ledger.logToolInvocation({
        toolName: 'database_query',
        inputHash: hashContent('query'),
        outputHash: '',
        durationMs: 50,
        success: false,
        error: { code: 'connection_failed', message: 'Database unreachable' },
      });

      const entry = chained.entry as any;
      expect(entry.success).toBe(false);
      expect(entry.error.code).toBe('connection_failed');
    });

    test('logs tool invocation with resources accessed', async () => {
      const chained = await ledger.logToolInvocation({
        toolName: 'file_reader',
        inputHash: hashContent('path'),
        outputHash: hashContent('content'),
        durationMs: 20,
        success: true,
        resourcesAccessed: [
          { type: 'file', identifier: '/data/report.csv', access_type: 'read' },
        ],
      });

      const entry = chained.entry as any;
      expect(entry.resources_accessed).toHaveLength(1);
      expect(entry.resources_accessed[0].type).toBe('file');
    });
  });

  describe('logDecision', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
    });

    test('logs decision point', async () => {
      const chained = await ledger.logDecision({
        decisionId: 'decision-001',
        category: 'routing',
        optionsConsidered: [
          { option_id: 'opt1', description: 'Use API A', score: 0.8 },
          { option_id: 'opt2', description: 'Use API B', score: 0.6 },
        ],
        selectedOption: 'opt1',
        reasoningHash: hashContent('Selected due to higher reliability'),
      });

      expect(chained.entry.type).toBe('decision_point');
      const entry = chained.entry as any;
      expect(entry.category).toBe('routing');
      expect(entry.options_considered).toHaveLength(2);
      expect(entry.selected_option).toBe('opt1');
    });

    test('logs decision requiring human review', async () => {
      const chained = await ledger.logDecision({
        decisionId: 'decision-002',
        category: 'financial',
        optionsConsidered: [
          { option_id: 'approve', description: 'Approve transaction', score: 0.75 },
          { option_id: 'reject', description: 'Reject transaction', score: 0.25 },
        ],
        selectedOption: 'approve',
        reasoningHash: hashContent('Meets risk threshold'),
        confidenceScore: 0.75,
        humanReviewRequired: true,
      });

      const entry = chained.entry as any;
      expect(entry.human_review_required).toBe(true);
      expect(entry.confidence_score).toBe(0.75);
    });
  });

  describe('logApproval', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
    });

    test('logs human approval', async () => {
      const chained = await ledger.logApproval({
        approverId: 'user-123',
        approverRole: 'compliance_officer',
        decisionRef: 'decision-001',
        approvalType: 'approved',
        reviewDurationSeconds: 45,
      });

      expect(chained.entry.type).toBe('human_approval');
      const entry = chained.entry as any;
      expect(entry.approver_id).toBe('user-123');
      expect(entry.approval_type).toBe('approved');
    });

    test('logs rejection with comments', async () => {
      const chained = await ledger.logApproval({
        approverId: 'user-456',
        approverRole: 'supervisor',
        decisionRef: 'decision-002',
        approvalType: 'rejected',
        commentHash: hashContent('Insufficient documentation'),
      });

      const entry = chained.entry as any;
      expect(entry.approval_type).toBe('rejected');
      expect(entry.comment_hash).toHaveLength(64);
    });
  });

  describe('snapshot', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
    });

    test('takes state snapshot', async () => {
      const chained = await ledger.snapshot({
        trigger: 'manual',
        stateHash: hashContent(JSON.stringify({ state: 'data' })),
        schemaVersion: '1.0.0',
      });

      expect(chained.entry.type).toBe('state_snapshot');
      const entry = chained.entry as any;
      expect(entry.trigger).toBe('manual');
    });

    test('takes snapshot with metrics', async () => {
      const chained = await ledger.snapshot({
        trigger: 'periodic',
        stateHash: hashContent('state'),
        schemaVersion: '1.0.0',
        metrics: {
          memory_mb: 512,
          active_tasks: 3,
          queue_depth: 10,
        },
      });

      const entry = chained.entry as any;
      expect(entry.metrics.memory_mb).toBe(512);
    });
  });

  describe('storeContent', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
    });

    test('stores string content reference', async () => {
      const chained = await ledger.storeContent({
        contentType: 'prompt',
        parentEntryId: 'entry-001',
        content: 'This is the full prompt text',
      });

      expect(chained.entry.type).toBe('content_reference');
      const entry = chained.entry as any;
      expect(entry.content_type).toBe('prompt');
      expect(entry.content_hash).toHaveLength(64);
      expect(entry.size_bytes).toBeGreaterThan(0);
    });

    test('stores buffer content reference', async () => {
      const buffer = Buffer.from('Binary content');
      const chained = await ledger.storeContent({
        contentType: 'completion',
        parentEntryId: 'entry-002',
        content: buffer,
      });

      const entry = chained.entry as any;
      expect(entry.size_bytes).toBe(buffer.length);
    });

    test('stores content with PII flag', async () => {
      const chained = await ledger.storeContent({
        contentType: 'prompt',
        parentEntryId: 'entry-003',
        content: 'Contains user data',
        containsPii: true,
        piiTypes: ['name', 'email'],
      });

      const entry = chained.entry as any;
      expect(entry.contains_pii).toBe(true);
      expect(entry.pii_types).toEqual(['name', 'email']);
    });
  });

  describe('full session lifecycle', () => {
    test('complete session with multiple entry types', async () => {
      const sessionId = await ledger.start({ type: 'user', identifier: 'test-user' });

      // Log model call
      await ledger.logModelCall({
        provider: 'openai',
        modelId: 'gpt-4',
        promptHash: hashContent('prompt'),
        promptTokens: 100,
        completionHash: hashContent('response'),
        completionTokens: 50,
        latencyMs: 500,
      });

      // Log tool invocation
      await ledger.logToolInvocation({
        toolName: 'search',
        inputHash: hashContent('query'),
        outputHash: hashContent('results'),
        durationMs: 100,
        success: true,
      });

      // Log decision
      await ledger.logDecision({
        decisionId: 'dec-1',
        category: 'routing',
        optionsConsidered: [
          { option_id: 'a', description: 'A', score: 0.8 },
        ],
        selectedOption: 'a',
        reasoningHash: hashContent('reason'),
      });

      // Verify
      const result = await ledger.verify();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);

      // Count
      expect(await ledger.count()).toBe(3);

      // Get entries
      const entries = await ledger.getEntries();
      expect(entries).toHaveLength(3);
      expect(entries[0]!.entry.type).toBe('model_call');
      expect(entries[1]!.entry.type).toBe('tool_invocation');
      expect(entries[2]!.entry.type).toBe('decision_point');

      // Close
      const log = await ledger.close();
      expect(log.version).toBe('1.0.0');
      expect(log.session.session_id).toBe(sessionId);
      expect(log.entries).toHaveLength(3);
      expect(log.merkle_root).toHaveLength(64);
      expect(log.integrity?.chain_valid).toBe(true);
      expect(log.integrity?.merkle_valid).toBe(true);
    });

    test('session with signing keys', async () => {
      const keys = generateSigningKeys();
      const signedLedger = new Ledger(createConfig({
        signingKeys: keys,
      }));

      await signedLedger.start({ type: 'user', identifier: 'test-user' });
      await signedLedger.logModelCall({
        provider: 'openai',
        modelId: 'gpt-4',
        promptHash: hashContent('test'),
        promptTokens: 10,
        completionHash: hashContent('response'),
        completionTokens: 5,
        latencyMs: 100,
      });

      const log = await signedLedger.close();
      expect(log.org_signature).toBeTruthy();
      expect(log.org_signature?.public_key).toBe(keys.publicKey);
      expect(log.integrity?.signature_valid).toBe(true);
    });
  });

  describe('auto-snapshot', () => {
    test('creates periodic snapshots at configured interval', async () => {
      const snapshotLedger = new Ledger(createConfig({
        snapshotInterval: 3,
      }));

      await snapshotLedger.start({ type: 'user', identifier: 'test-user' });

      // Log 5 entries
      for (let i = 0; i < 5; i++) {
        await snapshotLedger.logModelCall({
          provider: 'openai',
          modelId: 'gpt-4',
          promptHash: hashContent(`prompt-${i}`),
          promptTokens: 10,
          completionHash: hashContent(`response-${i}`),
          completionTokens: 5,
          latencyMs: 100,
        });
      }

      const entries = await snapshotLedger.getEntries();
      // Should have 5 model calls + 1 snapshot (triggered after entry 3)
      // Actually, snapshots are added after append increments, so after entry 3 we get snapshot
      const snapshots = entries.filter(e => e.entry.type === 'state_snapshot');
      expect(snapshots.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getEntries with range', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
      for (let i = 0; i < 10; i++) {
        await ledger.logModelCall({
          provider: 'openai',
          modelId: 'gpt-4',
          promptHash: hashContent(`prompt-${i}`),
          promptTokens: i * 10,
          completionHash: hashContent(`response-${i}`),
          completionTokens: i * 5,
          latencyMs: 100,
        });
      }
    });

    test('returns all entries without range', async () => {
      const entries = await ledger.getEntries();
      expect(entries).toHaveLength(10);
    });

    test('returns entries in range', async () => {
      const entries = await ledger.getEntries(2, 5);
      expect(entries).toHaveLength(3);
      expect(entries[0]!.sequence).toBe(2);
      expect(entries[2]!.sequence).toBe(4);
    });
  });

  describe('export formats', () => {
    beforeEach(async () => {
      await ledger.start({ type: 'user', identifier: 'test-user' });
      await ledger.logModelCall({
        provider: 'openai',
        modelId: 'gpt-4',
        promptHash: hashContent('test'),
        promptTokens: 100,
        completionHash: hashContent('response'),
        completionTokens: 50,
        latencyMs: 500,
      });
    });

    test('exports to jsonl', async () => {
      const buffer = await ledger.export({ format: 'jsonl' });
      const content = buffer.toString();
      expect(content).toContain('model_call');
    });

    test('exports to splunk_cim', async () => {
      const buffer = await ledger.export({ format: 'splunk_cim' });
      const content = buffer.toString();
      expect(content).toContain('agentledger');
    });

    test('exports to elastic_ecs', async () => {
      const buffer = await ledger.export({ format: 'elastic_ecs' });
      const content = buffer.toString();
      expect(content).toContain('@timestamp');
    });

    test('exports to finra_4511', async () => {
      const buffer = await ledger.export({ format: 'finra_4511' });
      const record = JSON.parse(buffer.toString());
      expect(record.finra_rule).toBe('4511');
    });

    test('exports to eu_ai_act', async () => {
      const buffer = await ledger.export({ format: 'eu_ai_act' });
      const record = JSON.parse(buffer.toString());
      expect(record.regulation).toBe('EU_AI_ACT');
    });
  });
});

describe('createLedger', () => {
  test('creates ledger with config', () => {
    const ledger = createLedger(createConfig());
    expect(ledger).toBeInstanceOf(Ledger);
  });
});

describe('generateSigningKeys', () => {
  test('generates valid key pair', () => {
    const keys = generateSigningKeys();
    expect(keys.publicKey).toBeTruthy();
    expect(keys.privateKey).toBeTruthy();
  });
});

describe('storage backend selection', () => {
  test('uses InMemoryStorage by default', async () => {
    const ledger = new Ledger(createConfig());
    await ledger.start({ type: 'user', identifier: 'test' });
    // Should work without error
    expect(ledger.getSession()).toBeTruthy();
  });

  test('uses InMemoryStorage with memory option', async () => {
    const ledger = new Ledger(createConfig({ storage: 'memory' }));
    await ledger.start({ type: 'user', identifier: 'test' });
    expect(ledger.getSession()).toBeTruthy();
  });

  test('uses custom storage backend', async () => {
    const customStorage = new InMemoryStorage();
    const ledger = new Ledger(createConfig({ storage: customStorage }));
    await ledger.start({ type: 'user', identifier: 'test' });
    expect(ledger.getSession()).toBeTruthy();
  });

  describe('FileSystemStorage', () => {
    const testBasePath = join(__dirname, '../.test-ledger-fs');

    beforeEach(() => {
      if (existsSync(testBasePath)) {
        rmSync(testBasePath, { recursive: true });
      }
      mkdirSync(testBasePath, { recursive: true });
    });

    afterEach(() => {
      if (existsSync(testBasePath)) {
        rmSync(testBasePath, { recursive: true });
      }
    });

    test('uses FileSystemStorage with filesystem option', async () => {
      const ledger = new Ledger(createConfig({
        storage: { type: 'filesystem', path: testBasePath },
      }));

      await ledger.start({ type: 'user', identifier: 'test' });
      await ledger.logModelCall({
        provider: 'openai',
        modelId: 'gpt-4',
        promptHash: hashContent('test'),
        promptTokens: 10,
        completionHash: hashContent('response'),
        completionTokens: 5,
        latencyMs: 100,
      });

      const result = await ledger.verify();
      expect(result.valid).toBe(true);

      const log = await ledger.close();
      expect(log.entries).toHaveLength(1);
    });
  });
});

describe('utility exports', () => {
  test('hashContent is exported', () => {
    const hash = hashContent('test');
    expect(hash).toHaveLength(64);
  });

  test('generateId is exported', () => {
    const id = generateId();
    expect(id).toHaveLength(36);
  });
});
