/**
 * Tests for @agentledger/cli package
 */

import { spawn, SpawnOptions } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  Ledger,
  hashContent,
  generateKeyPair,
} from 'agentledger-core';

const testDir = join(__dirname, '../.test-cli');
const cliPath = join(__dirname, '../src/index.ts');

// Helper to run CLI command
function runCli(args: string[], cwd: string = testDir): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const options: SpawnOptions = {
      cwd,
      shell: true,
    };

    const proc = spawn('npx', ['ts-node', cliPath, ...args], options);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

// Helper to create a valid audit log
async function createTestLog(options: {
  signed?: boolean;
  entries?: number;
  includeErrors?: boolean;
  includeDecisions?: boolean;
} = {}): Promise<string> {
  const keys = options.signed ? generateKeyPair() : undefined;

  const ledger = new Ledger({
    orgId: 'test-org',
    agentId: 'test-agent',
    agentVersion: '1.0.0',
    environment: 'test',
    compliance: ['FINRA_4511', 'EU_AI_ACT'],
    signingKeys: keys,
  });

  await ledger.start({ type: 'user', identifier: 'test-user' });

  // Add entries
  const entryCount = options.entries ?? 3;
  for (let i = 0; i < entryCount; i++) {
    await ledger.logModelCall({
      provider: 'openai',
      modelId: 'gpt-4',
      promptHash: hashContent(`prompt-${i}`),
      promptTokens: 100 + i * 10,
      completionHash: hashContent(`response-${i}`),
      completionTokens: 50 + i * 5,
      latencyMs: 500 + i * 50,
      costUsd: 0.01 * (i + 1),
    });

    if (i % 2 === 0) {
      await ledger.logToolInvocation({
        toolName: `tool-${i}`,
        inputHash: hashContent(`input-${i}`),
        outputHash: hashContent(`output-${i}`),
        durationMs: 100 + i * 10,
        success: !options.includeErrors || i !== 0,
        error: options.includeErrors && i === 0 ? { code: 'ERROR', message: 'Test error' } : undefined,
      });
    }
  }

  if (options.includeDecisions) {
    await ledger.logDecision({
      decisionId: 'decision-1',
      category: 'routing',
      optionsConsidered: [
        { option_id: 'opt1', description: 'Option 1', score: 0.8 },
        { option_id: 'opt2', description: 'Option 2', score: 0.6 },
      ],
      selectedOption: 'opt1',
      reasoningHash: hashContent('reasoning'),
      humanReviewRequired: true,
    });

    await ledger.logApproval({
      approverId: 'approver-1',
      approverRole: 'manager',
      decisionRef: 'decision-1',
      approvalType: 'approved',
    });
  }

  const log = await ledger.close();
  const logPath = join(testDir, `test-log-${Date.now()}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2));

  return logPath;
}

// Helper to create a tampered log
async function createTamperedLog(): Promise<string> {
  const ledger = new Ledger({
    orgId: 'test-org',
    agentId: 'test-agent',
    environment: 'test',
    compliance: ['FINRA_4511'],
  });

  await ledger.start({ type: 'user', identifier: 'test-user' });

  await ledger.logModelCall({
    provider: 'openai',
    modelId: 'gpt-4',
    promptHash: hashContent('prompt'),
    promptTokens: 100,
    completionHash: hashContent('response'),
    completionTokens: 50,
    latencyMs: 500,
  });

  const log = await ledger.close();

  // Tamper with the first entry
  log.entries[0]!.entry_hash = 'tampered-hash-123456';

  const logPath = join(testDir, `tampered-log-${Date.now()}.json`);
  writeFileSync(logPath, JSON.stringify(log, null, 2));

  return logPath;
}

describe('CLI', () => {
  beforeAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('help', () => {
    test('shows help with --help flag', async () => {
      const result = await runCli(['--help']);
      expect(result.stdout).toContain('AgentLedger CLI');
      expect(result.stdout).toContain('verify');
      expect(result.stdout).toContain('export');
      expect(result.stdout).toContain('replay');
      expect(result.stdout).toContain('summary');
    });

    test('shows help with no arguments', async () => {
      const result = await runCli([]);
      expect(result.stdout).toContain('AgentLedger CLI');
    });
  });

  describe('verify command', () => {
    test('verifies valid log', async () => {
      const logPath = await createTestLog();
      const result = await runCli(['verify', logPath]);

      expect(result.stdout).toContain('Chain integrity verified');
      expect(result.stdout).toContain('Merkle root verified');
      expect(result.stdout).toContain('All verifications passed');
      expect(result.code).toBe(0);
    }, 30000);

    test('verifies signed log', async () => {
      const logPath = await createTestLog({ signed: true });
      const result = await runCli(['verify', logPath]);

      expect(result.stdout).toContain('Organization signature verified');
      expect(result.code).toBe(0);
    }, 30000);

    test('detects tampered log', async () => {
      const logPath = await createTamperedLog();
      const result = await runCli(['verify', logPath]);

      expect(result.stdout).toContain('FAILED');
      expect(result.code).toBe(1);
    }, 30000);

    test('handles missing file', async () => {
      const result = await runCli(['verify', 'nonexistent.json']);

      expect(result.stdout).toContain('File not found');
      expect(result.code).toBe(1);
    }, 30000);
  });

  describe('export command', () => {
    let logPath: string;

    beforeAll(async () => {
      logPath = await createTestLog({ entries: 5, includeDecisions: true });
    }, 30000);

    test('exports to jsonl format', async () => {
      const result = await runCli(['export', logPath, '--format=jsonl']);

      expect(result.stdout).toContain('Format: jsonl');
      expect(result.stdout).toContain('Export complete');
      expect(result.code).toBe(0);
    }, 30000);

    test('exports to splunk_cim format', async () => {
      const result = await runCli(['export', logPath, '--format=splunk_cim']);

      expect(result.stdout).toContain('Format: splunk_cim');
      expect(result.stdout).toContain('Export complete');
      expect(result.code).toBe(0);
    }, 30000);

    test('exports to elastic_ecs format', async () => {
      const result = await runCli(['export', logPath, '--format=elastic_ecs']);

      expect(result.stdout).toContain('Format: elastic_ecs');
      expect(result.stdout).toContain('Export complete');
      expect(result.code).toBe(0);
    }, 30000);

    test('exports to finra_4511 format', async () => {
      const result = await runCli(['export', logPath, '--format=finra_4511']);

      expect(result.stdout).toContain('Format: finra_4511');
      expect(result.stdout).toContain('Export complete');
      expect(result.code).toBe(0);
    }, 30000);

    test('exports to eu_ai_act format', async () => {
      const result = await runCli(['export', logPath, '--format=eu_ai_act']);

      expect(result.stdout).toContain('Format: eu_ai_act');
      expect(result.stdout).toContain('Export complete');
      expect(result.code).toBe(0);
    }, 30000);

    test('handles unknown format', async () => {
      const result = await runCli(['export', logPath, '--format=unknown']);

      expect(result.stdout).toContain('Unknown format');
      expect(result.code).toBe(1);
    }, 30000);
  });

  describe('replay command', () => {
    test('replays session timeline', async () => {
      const logPath = await createTestLog({ entries: 5, includeDecisions: true, includeErrors: true });
      const result = await runCli(['replay', logPath]);

      expect(result.stdout).toContain('Session Replay');
      expect(result.stdout).toContain('Timeline');
      expect(result.stdout).toContain('Model:');
      expect(result.stdout).toContain('Tool:');
      expect(result.stdout).toContain('Decision:');
      expect(result.stdout).toContain('Human:');
      expect(result.stdout).toContain('Summary');
      expect(result.stdout).toContain('Replay complete');
      expect(result.code).toBe(0);
    }, 30000);
  });

  describe('summary command', () => {
    test('shows session summary', async () => {
      const logPath = await createTestLog({ entries: 5, includeDecisions: true, signed: true });
      const result = await runCli(['summary', logPath]);

      expect(result.stdout).toContain('AgentLedger Summary');
      expect(result.stdout).toContain('Session');
      expect(result.stdout).toContain('test-org');
      expect(result.stdout).toContain('test-agent');
      expect(result.stdout).toContain('Compliance');
      expect(result.stdout).toContain('FINRA_4511');
      expect(result.stdout).toContain('Statistics');
      expect(result.stdout).toContain('Model calls:');
      expect(result.stdout).toContain('Token Usage');
      expect(result.stdout).toContain('gpt-4');
      expect(result.stdout).toContain('Integrity');
      expect(result.stdout).toContain('Compliance Checklist');
      expect(result.stdout).toContain('Compliance Score:');
      expect(result.code).toBe(0);
    }, 30000);
  });

  describe('error handling', () => {
    test('handles unknown command', async () => {
      const result = await runCli(['unknown', 'file.json']);

      expect(result.stdout).toContain('Unknown command');
      expect(result.code).toBe(1);
    }, 30000);

    test('handles missing log file argument', async () => {
      const result = await runCli(['verify']);

      expect(result.stdout).toContain('Please provide a log file path');
      expect(result.code).toBe(1);
    }, 30000);

    test('handles invalid JSON file', async () => {
      const invalidPath = join(testDir, 'invalid.json');
      writeFileSync(invalidPath, 'not valid json');

      const result = await runCli(['verify', invalidPath]);

      expect(result.stdout).toContain('Failed to parse log');
      expect(result.code).toBe(1);
    }, 30000);
  });
});
