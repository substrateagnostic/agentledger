#!/usr/bin/env node
/**
 * AgentLedger CLI
 * Command-line tool for verifying, exporting, and analyzing audit logs.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';
import {
  AuditLog,
  verifyChain,
  verifyAuditLogSignature,
  buildMerkleTree,
  verifyMerkleProof,
  getMerkleProof,
} from 'agentledger-core';

// ============================================================================
// COLORS (ANSI escape codes for terminal output)
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function success(msg: string): string {
  return `${colors.green}✓${colors.reset} ${msg}`;
}

function error(msg: string): string {
  return `${colors.red}✗${colors.reset} ${msg}`;
}

function warn(msg: string): string {
  return `${colors.yellow}!${colors.reset} ${msg}`;
}

function info(msg: string): string {
  return `${colors.blue}ℹ${colors.reset} ${msg}`;
}

// ============================================================================
// COMMAND: VERIFY
// ============================================================================

function verify(logPath: string, options: { verbose?: boolean }): void {
  console.log(`\n${colors.bright}AgentLedger Verification${colors.reset}`);
  console.log(`${colors.gray}${'─'.repeat(50)}${colors.reset}\n`);
  
  // Load log
  if (!existsSync(logPath)) {
    console.log(error(`File not found: ${logPath}`));
    process.exit(1);
  }
  
  let log: AuditLog;
  try {
    const content = readFileSync(logPath, 'utf-8');
    log = JSON.parse(content);
  } catch (e) {
    console.log(error(`Failed to parse log: ${(e as Error).message}`));
    process.exit(1);
  }
  
  console.log(info(`Session: ${log.session.session_id}`));
  console.log(info(`Organization: ${log.session.org_id}`));
  console.log(info(`Agent: ${log.session.agent_id}`));
  console.log(info(`Entries: ${log.entries.length}`));
  console.log('');
  
  // Verify hash chain
  console.log(`${colors.cyan}Hash Chain Verification${colors.reset}`);
  const chainResult = verifyChain(log.entries);
  
  if (chainResult.valid) {
    console.log(success(`Chain integrity verified (${chainResult.verified_count} entries)`));
  } else {
    console.log(error('Chain integrity FAILED'));
    for (const err of chainResult.errors) {
      console.log(`  ${colors.red}→${colors.reset} ${err}`);
    }
  }
  
  // Verify Merkle root
  console.log(`\n${colors.cyan}Merkle Tree Verification${colors.reset}`);
  if (log.merkle_root) {
    const hashes = log.entries.map(e => e.entry_hash);
    const { root } = buildMerkleTree(hashes);
    
    if (root === log.merkle_root) {
      console.log(success('Merkle root verified'));
    } else {
      console.log(error('Merkle root mismatch'));
      console.log(`  ${colors.gray}Expected: ${log.merkle_root}${colors.reset}`);
      console.log(`  ${colors.gray}Computed: ${root}${colors.reset}`);
    }
  } else {
    console.log(warn('No Merkle root present'));
  }
  
  // Verify signature
  console.log(`\n${colors.cyan}Signature Verification${colors.reset}`);
  if (log.org_signature) {
    const sigValid = verifyAuditLogSignature(log);
    if (sigValid) {
      console.log(success('Organization signature verified'));
      console.log(`  ${colors.gray}Signed at: ${log.org_signature.signed_at}${colors.reset}`);
    } else {
      console.log(error('Signature verification FAILED'));
    }
  } else {
    console.log(warn('No organization signature present'));
  }
  
  // Summary
  console.log(`\n${colors.gray}${'─'.repeat(50)}${colors.reset}`);
  const allValid = chainResult.valid && 
    (!log.merkle_root || log.merkle_root === buildMerkleTree(log.entries.map(e => e.entry_hash)).root) &&
    (!log.org_signature || verifyAuditLogSignature(log));
  
  if (allValid) {
    console.log(`\n${colors.green}${colors.bright}✓ All verifications passed${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${colors.red}${colors.bright}✗ Verification failed${colors.reset}\n`);
    process.exit(1);
  }
}

// ============================================================================
// COMMAND: EXPORT
// ============================================================================

function exportLog(logPath: string, format: string, outputPath?: string): void {
  console.log(`\n${colors.bright}AgentLedger Export${colors.reset}`);
  console.log(`${colors.gray}${'─'.repeat(50)}${colors.reset}\n`);
  
  // Load log
  if (!existsSync(logPath)) {
    console.log(error(`File not found: ${logPath}`));
    process.exit(1);
  }
  
  let log: AuditLog;
  try {
    const content = readFileSync(logPath, 'utf-8');
    log = JSON.parse(content);
  } catch (e) {
    console.log(error(`Failed to parse log: ${(e as Error).message}`));
    process.exit(1);
  }
  
  console.log(info(`Format: ${format}`));
  console.log(info(`Entries: ${log.entries.length}`));
  
  // Export based on format
  let output: string;
  let extension: string;
  
  switch (format) {
    case 'jsonl':
      output = exportJsonl(log);
      extension = 'jsonl';
      break;
    case 'splunk':
    case 'splunk_cim':
      output = exportSplunkCIM(log);
      extension = 'json';
      break;
    case 'elastic':
    case 'elastic_ecs':
      output = exportElasticECS(log);
      extension = 'ndjson';
      break;
    case 'finra':
    case 'finra_4511':
      output = exportFINRA4511(log);
      extension = 'json';
      break;
    case 'eu_ai_act':
      output = exportEUAIAct(log);
      extension = 'json';
      break;
    default:
      console.log(error(`Unknown format: ${format}`));
      console.log(info('Available formats: jsonl, splunk_cim, elastic_ecs, finra_4511, eu_ai_act'));
      process.exit(1);
  }
  
  // Write output
  const finalPath = outputPath || `${basename(logPath, '.json')}.${format}.${extension}`;
  writeFileSync(finalPath, output);
  
  console.log(success(`Exported to: ${finalPath}`));
  console.log(`\n${colors.green}${colors.bright}✓ Export complete${colors.reset}\n`);
}

function exportJsonl(log: AuditLog): string {
  const lines = [
    JSON.stringify({ type: 'session', ...log.session }),
    ...log.entries.map(e => JSON.stringify({ type: 'entry', ...e })),
    JSON.stringify({ type: 'integrity', ...log.integrity }),
  ];
  return lines.join('\n');
}

function exportSplunkCIM(log: AuditLog): string {
  const events = log.entries.map(entry => ({
    time: new Date(entry.entry.timestamp).getTime() / 1000,
    host: log.session.agent_id,
    source: 'agentledger',
    sourcetype: 'ai:audit',
    event: {
      session_id: log.session.session_id,
      org_id: log.session.org_id,
      entry_type: entry.entry.type,
      sequence: entry.sequence,
      ...entry.entry,
    },
  }));
  return events.map(e => JSON.stringify(e)).join('\n');
}

function exportElasticECS(log: AuditLog): string {
  const docs = log.entries.map(entry => ({
    '@timestamp': entry.entry.timestamp,
    'ecs.version': '8.0.0',
    'event.kind': 'event',
    'event.category': ['process'],
    'event.action': entry.entry.type,
    'event.id': entry.entry.entry_id,
    'agent.id': log.session.agent_id,
    'organization.id': log.session.org_id,
    'session.id': log.session.session_id,
    agentledger: entry.entry,
  }));
  return docs.map(d => JSON.stringify(d)).join('\n');
}

function exportFINRA4511(log: AuditLog): string {
  const record = {
    record_type: 'AI_AGENT_AUDIT_LOG',
    finra_rule: '4511',
    firm_id: log.session.org_id,
    record_id: log.session.session_id,
    creation_date: log.session.initiated_at,
    closure_date: log.session.closed_at,
    retention_period_years: Math.ceil(log.session.retention_days / 365),
    integrity: {
      chain_verified: log.integrity?.chain_valid,
      merkle_root: log.merkle_root,
      digital_signature: log.org_signature?.signature,
    },
    record_count: log.entries.length,
    records: log.entries.map(entry => ({
      sequence_number: entry.sequence,
      timestamp: entry.entry.timestamp,
      record_type: entry.entry.type,
      record_hash: entry.entry_hash,
      data: entry.entry,
    })),
  };
  return JSON.stringify(record, null, 2);
}

function exportEUAIAct(log: AuditLog): string {
  const record = {
    schema_version: '1.0',
    regulation: 'EU_AI_ACT',
    article: '12',
    ai_system: {
      provider: log.session.org_id,
      system_id: log.session.agent_id,
      version: log.session.agent_version,
    },
    operation_log: {
      session_id: log.session.session_id,
      start_time: log.session.initiated_at,
      end_time: log.session.closed_at,
    },
    traceability: {
      total_events: log.entries.length,
      merkle_root: log.merkle_root,
      chain_integrity: log.integrity?.chain_valid,
    },
    events: log.entries.map(entry => ({
      event_id: entry.entry.entry_id,
      timestamp: entry.entry.timestamp,
      event_type: entry.entry.type,
      hash: entry.entry_hash,
    })),
  };
  return JSON.stringify(record, null, 2);
}

// ============================================================================
// COMMAND: REPLAY
// ============================================================================

function replay(logPath: string, options: { session?: string }): void {
  console.log(`\n${colors.bright}AgentLedger Session Replay${colors.reset}`);
  console.log(`${colors.gray}${'─'.repeat(50)}${colors.reset}\n`);
  
  // Load log
  if (!existsSync(logPath)) {
    console.log(error(`File not found: ${logPath}`));
    process.exit(1);
  }
  
  let log: AuditLog;
  try {
    const content = readFileSync(logPath, 'utf-8');
    log = JSON.parse(content);
  } catch (e) {
    console.log(error(`Failed to parse log: ${(e as Error).message}`));
    process.exit(1);
  }
  
  console.log(info(`Session: ${log.session.session_id}`));
  console.log(info(`Started: ${log.session.initiated_at}`));
  console.log(info(`Ended: ${log.session.closed_at || 'In progress'}`));
  console.log(info(`Environment: ${log.session.environment}`));
  console.log(info(`Compliance: ${log.session.compliance_contexts.join(', ')}`));
  console.log('');
  
  // Replay entries as timeline
  console.log(`${colors.cyan}Timeline${colors.reset}\n`);
  
  let prevTime: Date | null = null;
  
  for (const entry of log.entries) {
    const time = new Date(entry.entry.timestamp);
    const timeStr = time.toISOString().split('T')[1]?.split('.')[0] ?? '';
    
    // Calculate delta
    let delta = '';
    if (prevTime) {
      const ms = time.getTime() - prevTime.getTime();
      if (ms < 1000) {
        delta = `+${ms}ms`;
      } else {
        delta = `+${(ms / 1000).toFixed(1)}s`;
      }
    }
    prevTime = time;
    
    // Format based on entry type
    const { type } = entry.entry;
    let icon: string;
    let desc: string;
    
    switch (type) {
      case 'model_call':
        icon = '🤖';
        desc = `Model: ${entry.entry.model_id} (${entry.entry.prompt_tokens}→${entry.entry.completion_tokens} tokens)`;
        if (entry.entry.error) {
          desc += ` ${colors.red}[ERROR: ${entry.entry.error.message}]${colors.reset}`;
        }
        break;
      case 'tool_invocation':
        icon = '🔧';
        desc = `Tool: ${entry.entry.tool_name}`;
        if (!entry.entry.success) {
          desc += ` ${colors.red}[FAILED]${colors.reset}`;
        }
        break;
      case 'decision_point':
        icon = '🔀';
        desc = `Decision: ${entry.entry.category} → ${entry.entry.selected_option}`;
        if (entry.entry.human_review_required) {
          desc += ` ${colors.yellow}[HUMAN REVIEW REQUIRED]${colors.reset}`;
        }
        break;
      case 'human_approval':
        icon = '👤';
        desc = `Human: ${entry.entry.approver_role} → ${entry.entry.approval_type}`;
        break;
      case 'state_snapshot':
        icon = '📸';
        desc = `Snapshot: ${entry.entry.trigger}`;
        break;
      case 'content_reference':
        icon = '📎';
        desc = `Content: ${entry.entry.content_type} (${entry.entry.size_bytes} bytes)`;
        if (entry.entry.contains_pii) {
          desc += ` ${colors.yellow}[PII]${colors.reset}`;
        }
        break;
      default:
        icon = '•';
        desc = `Unknown: ${type}`;
    }
    
    console.log(`${colors.gray}${timeStr}${colors.reset} ${delta.padEnd(8)} ${icon} ${desc}`);
  }
  
  // Summary
  console.log(`\n${colors.gray}${'─'.repeat(50)}${colors.reset}`);
  
  const modelCalls = log.entries.filter(e => e.entry.type === 'model_call');
  const toolCalls = log.entries.filter(e => e.entry.type === 'tool_invocation');
  const decisions = log.entries.filter(e => e.entry.type === 'decision_point');
  const approvals = log.entries.filter(e => e.entry.type === 'human_approval');
  
  const totalTokens = modelCalls.reduce((sum, e) => {
    if (e.entry.type === 'model_call') {
      return sum + e.entry.prompt_tokens + e.entry.completion_tokens;
    }
    return sum;
  }, 0);
  
  const totalCost = modelCalls.reduce((sum, e) => {
    if (e.entry.type === 'model_call' && e.entry.cost_usd) {
      return sum + e.entry.cost_usd;
    }
    return sum;
  }, 0);
  
  console.log(`\n${colors.cyan}Summary${colors.reset}`);
  console.log(`  Model calls: ${modelCalls.length}`);
  console.log(`  Tool invocations: ${toolCalls.length}`);
  console.log(`  Decision points: ${decisions.length}`);
  console.log(`  Human approvals: ${approvals.length}`);
  console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);
  console.log(`  Estimated cost: $${totalCost.toFixed(4)}`);
  
  console.log(`\n${colors.green}${colors.bright}✓ Replay complete${colors.reset}\n`);
}

// ============================================================================
// COMMAND: SUMMARY
// ============================================================================

function summary(logPath: string): void {
  console.log(`\n${colors.bright}AgentLedger Summary${colors.reset}`);
  console.log(`${colors.gray}${'─'.repeat(50)}${colors.reset}\n`);
  
  // Load log
  if (!existsSync(logPath)) {
    console.log(error(`File not found: ${logPath}`));
    process.exit(1);
  }
  
  let log: AuditLog;
  try {
    const content = readFileSync(logPath, 'utf-8');
    log = JSON.parse(content);
  } catch (e) {
    console.log(error(`Failed to parse log: ${(e as Error).message}`));
    process.exit(1);
  }
  
  // Session info
  console.log(`${colors.cyan}Session${colors.reset}`);
  console.log(`  ID: ${log.session.session_id}`);
  console.log(`  Organization: ${log.session.org_id}`);
  console.log(`  Agent: ${log.session.agent_id} (v${log.session.agent_version || 'unknown'})`);
  console.log(`  Environment: ${log.session.environment}`);
  console.log(`  Started: ${log.session.initiated_at}`);
  console.log(`  Ended: ${log.session.closed_at || 'In progress'}`);
  
  // Compliance
  console.log(`\n${colors.cyan}Compliance${colors.reset}`);
  console.log(`  Frameworks: ${log.session.compliance_contexts.join(', ')}`);
  console.log(`  Retention: ${log.session.retention_days} days (${(log.session.retention_days / 365).toFixed(1)} years)`);
  
  // Statistics
  const modelCalls = log.entries.filter(e => e.entry.type === 'model_call');
  const toolCalls = log.entries.filter(e => e.entry.type === 'tool_invocation');
  const decisions = log.entries.filter(e => e.entry.type === 'decision_point');
  const approvals = log.entries.filter(e => e.entry.type === 'human_approval');
  const errors = log.entries.filter(e => {
    if (e.entry.type === 'model_call') return !!e.entry.error;
    if (e.entry.type === 'tool_invocation') return !e.entry.success;
    return false;
  });
  
  console.log(`\n${colors.cyan}Statistics${colors.reset}`);
  console.log(`  Total entries: ${log.entries.length}`);
  console.log(`  Model calls: ${modelCalls.length}`);
  console.log(`  Tool invocations: ${toolCalls.length}`);
  console.log(`  Decision points: ${decisions.length}`);
  console.log(`  Human approvals: ${approvals.length}`);
  console.log(`  Errors: ${errors.length}`);
  
  // Token usage
  const tokensByModel: Record<string, { prompt: number; completion: number }> = {};
  for (const entry of modelCalls) {
    if (entry.entry.type === 'model_call') {
      const model = entry.entry.model_id;
      if (!tokensByModel[model]) {
        tokensByModel[model] = { prompt: 0, completion: 0 };
      }
      tokensByModel[model].prompt += entry.entry.prompt_tokens;
      tokensByModel[model].completion += entry.entry.completion_tokens;
    }
  }
  
  console.log(`\n${colors.cyan}Token Usage${colors.reset}`);
  for (const [model, usage] of Object.entries(tokensByModel)) {
    console.log(`  ${model}: ${usage.prompt.toLocaleString()} in / ${usage.completion.toLocaleString()} out`);
  }
  
  // Cost
  const totalCost = modelCalls.reduce((sum, e) => {
    if (e.entry.type === 'model_call' && e.entry.cost_usd) {
      return sum + e.entry.cost_usd;
    }
    return sum;
  }, 0);
  console.log(`\n${colors.cyan}Cost${colors.reset}`);
  console.log(`  Estimated total: $${totalCost.toFixed(4)}`);
  
  // Integrity
  console.log(`\n${colors.cyan}Integrity${colors.reset}`);
  if (log.integrity) {
    console.log(`  Chain valid: ${log.integrity.chain_valid ? '✓' : '✗'}`);
    console.log(`  Merkle valid: ${log.integrity.merkle_valid ? '✓' : '✗'}`);
    if (log.integrity.signature_valid !== undefined) {
      console.log(`  Signature valid: ${log.integrity.signature_valid ? '✓' : '✗'}`);
    }
    console.log(`  Verified at: ${log.integrity.verified_at}`);
  } else {
    console.log(`  ${colors.yellow}Not yet verified${colors.reset}`);
  }
  
  // Compliance checklist
  console.log(`\n${colors.cyan}Compliance Checklist${colors.reset}`);
  
  const checks = [
    { name: 'Hash chain present', pass: log.entries.length > 0 && log.entries.every(e => e.entry_hash) },
    { name: 'Merkle root present', pass: !!log.merkle_root },
    { name: 'Organization signature', pass: !!log.org_signature },
    { name: 'Session closed', pass: !!log.session.closed_at },
    { name: 'Retention policy set', pass: log.session.retention_days > 0 },
    { name: 'All model calls logged', pass: modelCalls.every(e => e.entry.type === 'model_call' && e.entry.prompt_hash) },
    { name: 'Decision points documented', pass: decisions.length > 0 || modelCalls.length === 0 },
  ];
  
  for (const check of checks) {
    console.log(`  ${check.pass ? colors.green + '✓' : colors.red + '✗'}${colors.reset} ${check.name}`);
  }
  
  const passRate = checks.filter(c => c.pass).length / checks.length;
  console.log(`\n${colors.gray}${'─'.repeat(50)}${colors.reset}`);
  console.log(`\n${colors.cyan}Compliance Score: ${(passRate * 100).toFixed(0)}%${colors.reset}\n`);
}

// ============================================================================
// MAIN
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
${colors.bright}AgentLedger CLI${colors.reset}
AI Agent Audit Trail SDK

${colors.cyan}Usage:${colors.reset}
  agentledger verify <log-file>              Verify hash chain integrity
  agentledger export <log-file> --format=<f> Export to compliance format
  agentledger replay <log-file>              Replay session timeline
  agentledger summary <log-file>             Show statistics and compliance

${colors.cyan}Export Formats:${colors.reset}
  jsonl        Raw JSONL
  splunk_cim   Splunk Common Information Model
  elastic_ecs  Elastic Common Schema
  finra_4511   FINRA Books and Records
  eu_ai_act    EU AI Act Article 12

${colors.cyan}Examples:${colors.reset}
  agentledger verify audit.json
  agentledger export audit.json --format=finra_4511
  agentledger replay audit.json
  agentledger summary audit.json
`);
    return;
  }
  
  const command = args[0];
  const logPath = args[1];
  
  if (!logPath && command !== '--help') {
    console.log(error('Please provide a log file path'));
    process.exit(1);
  }
  
  // After the early return, logPath is guaranteed to be defined
  const resolvedPath = resolve(logPath!);

  switch (command) {
    case 'verify':
      verify(resolvedPath, { verbose: args.includes('--verbose') || args.includes('-v') });
      break;
    
    case 'export': {
      const formatArg = args.find(a => a.startsWith('--format='));
      const format = formatArg ? formatArg.split('=')[1] ?? 'jsonl' : 'jsonl';
      const outputArg = args.find(a => a.startsWith('--output='));
      const output = outputArg ? outputArg.split('=')[1] : undefined;
      exportLog(resolvedPath, format, output);
      break;
    }
    
    case 'replay':
      replay(resolvedPath, {});
      break;
    
    case 'summary':
      summary(resolvedPath);
      break;
    
    default:
      console.log(error(`Unknown command: ${command}`));
      console.log(info('Run "agentledger --help" for usage'));
      process.exit(1);
  }
}

main();
