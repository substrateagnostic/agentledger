/**
 * AgentLedger Storage Abstraction
 * Pluggable storage backends for audit logs.
 */

import { writeFileSync, readFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { AuditLog, ChainedEntry, SessionEnvelope, AuditEntry, ExportOptions } from './types';
import {
  createChainedEntry,
  verifyChain,
  buildMerkleTree,
  timestamp,
  signAuditLog,
  verifyAuditLogSignature
} from './crypto';

// ============================================================================
// STORAGE INTERFACE
// ============================================================================

export interface StorageBackend {
  /** Initialize storage for a new session */
  initialize(session: SessionEnvelope): Promise<void>;
  
  /** Append an entry to the log */
  append(entry: AuditEntry): Promise<ChainedEntry>;
  
  /** Get entries in a range */
  getRange(start: number, end: number): Promise<ChainedEntry[]>;
  
  /** Get all entries */
  getAll(): Promise<ChainedEntry[]>;
  
  /** Get current entry count */
  count(): Promise<number>;
  
  /** Verify chain integrity */
  verify(): Promise<{ valid: boolean; errors: string[] }>;
  
  /** Close the session and finalize the log */
  close(privateKey?: string, publicKey?: string): Promise<AuditLog>;
  
  /** Export to a specific format */
  export(options: ExportOptions): Promise<Buffer>;
  
  /** Get the current session */
  getSession(): SessionEnvelope;
}

// ============================================================================
// IN-MEMORY STORAGE (Development/Testing)
// ============================================================================

export class InMemoryStorage implements StorageBackend {
  private session!: SessionEnvelope;
  private entries: ChainedEntry[] = [];
  private contentStore: Map<string, Buffer> = new Map();
  
  async initialize(session: SessionEnvelope): Promise<void> {
    this.session = session;
    this.entries = [];
    this.contentStore.clear();
  }
  
  async append(entry: AuditEntry): Promise<ChainedEntry> {
    const lastEntry = this.entries[this.entries.length - 1];
    const previousHash = lastEntry ? lastEntry.entry_hash : '';
    
    const chained = createChainedEntry(entry, this.entries.length, previousHash);
    this.entries.push(chained);
    return chained;
  }
  
  async getRange(start: number, end: number): Promise<ChainedEntry[]> {
    return this.entries.slice(start, end);
  }
  
  async getAll(): Promise<ChainedEntry[]> {
    return [...this.entries];
  }
  
  async count(): Promise<number> {
    return this.entries.length;
  }
  
  async verify(): Promise<{ valid: boolean; errors: string[] }> {
    const result = verifyChain(this.entries);
    return { valid: result.valid, errors: result.errors };
  }
  
  async close(privateKey?: string, publicKey?: string): Promise<AuditLog> {
    const hashes = this.entries.map(e => e.entry_hash);
    const { root } = buildMerkleTree(hashes);
    
    const closedSession: SessionEnvelope = {
      ...this.session,
      closed_at: timestamp(),
    };
    
    const log: AuditLog = {
      version: '1.0.0',
      session: closedSession,
      entries: this.entries,
      merkle_root: root,
    };
    
    if (privateKey && publicKey) {
      log.org_signature = signAuditLog(log, privateKey, publicKey);
    }
    
    const verification = verifyChain(this.entries);
    log.integrity = {
      chain_valid: verification.valid,
      merkle_valid: true, // We just built it
      signature_valid: log.org_signature ? verifyAuditLogSignature(log) : undefined,
      verified_at: timestamp(),
    };
    
    return log;
  }
  
  async export(options: ExportOptions): Promise<Buffer> {
    const log = await this.close();
    return exportAuditLog(log, options);
  }
  
  getSession(): SessionEnvelope {
    return this.session;
  }
  
  /** Store content for later retrieval (content-addressed) */
  storeContent(hash: string, content: Buffer): void {
    this.contentStore.set(hash, content);
  }
  
  /** Retrieve stored content by hash */
  getContent(hash: string): Buffer | undefined {
    return this.contentStore.get(hash);
  }
}

// ============================================================================
// FILE SYSTEM STORAGE (Single Node Production)
// ============================================================================

export class FileSystemStorage implements StorageBackend {
  private session!: SessionEnvelope;
  private basePath: string;
  private logPath!: string;
  private entryCount: number = 0;
  private lastHash: string = '';
  
  constructor(basePath: string) {
    this.basePath = basePath;
  }
  
  async initialize(session: SessionEnvelope): Promise<void> {
    this.session = session;
    this.entryCount = 0;
    this.lastHash = '';
    
    // Create directory structure
    const sessionDir = join(this.basePath, session.org_id, session.session_id);
    mkdirSync(sessionDir, { recursive: true });
    
    this.logPath = join(sessionDir, 'audit.jsonl');
    
    // Write session header
    const header = JSON.stringify({ type: 'session', data: session }) + '\n';
    writeFileSync(this.logPath, header);
  }
  
  async append(entry: AuditEntry): Promise<ChainedEntry> {
    const chained = createChainedEntry(entry, this.entryCount, this.lastHash);
    
    const line = JSON.stringify({ type: 'entry', data: chained }) + '\n';
    appendFileSync(this.logPath, line);
    
    this.entryCount++;
    this.lastHash = chained.entry_hash;
    
    return chained;
  }
  
  async getRange(start: number, end: number): Promise<ChainedEntry[]> {
    const entries = await this.getAll();
    return entries.slice(start, end);
  }
  
  async getAll(): Promise<ChainedEntry[]> {
    const content = readFileSync(this.logPath, 'utf-8');
    const lines = content.trim().split('\n');
    
    const entries: ChainedEntry[] = [];
    for (const line of lines) {
      const parsed = JSON.parse(line);
      if (parsed.type === 'entry') {
        entries.push(parsed.data);
      }
    }
    
    return entries;
  }
  
  async count(): Promise<number> {
    return this.entryCount;
  }
  
  async verify(): Promise<{ valid: boolean; errors: string[] }> {
    const entries = await this.getAll();
    const result = verifyChain(entries);
    return { valid: result.valid, errors: result.errors };
  }
  
  async close(privateKey?: string, publicKey?: string): Promise<AuditLog> {
    const entries = await this.getAll();
    const hashes = entries.map(e => e.entry_hash);
    const { root } = buildMerkleTree(hashes);
    
    const closedSession: SessionEnvelope = {
      ...this.session,
      closed_at: timestamp(),
    };
    
    const log: AuditLog = {
      version: '1.0.0',
      session: closedSession,
      entries,
      merkle_root: root,
    };
    
    if (privateKey && publicKey) {
      log.org_signature = signAuditLog(log, privateKey, publicKey);
    }
    
    const verification = verifyChain(entries);
    log.integrity = {
      chain_valid: verification.valid,
      merkle_valid: true,
      signature_valid: log.org_signature ? verifyAuditLogSignature(log) : undefined,
      verified_at: timestamp(),
    };
    
    // Write final log
    const finalPath = this.logPath.replace('.jsonl', '.final.json');
    writeFileSync(finalPath, JSON.stringify(log, null, 2));
    
    return log;
  }
  
  async export(options: ExportOptions): Promise<Buffer> {
    const log = await this.close();
    return exportAuditLog(log, options);
  }
  
  getSession(): SessionEnvelope {
    return this.session;
  }
}

// ============================================================================
// S3-COMPATIBLE STORAGE (Distributed Production)
// ============================================================================

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export class S3Storage implements StorageBackend {
  private session!: SessionEnvelope;
  private config: S3Config;
  private entries: ChainedEntry[] = [];
  private pendingWrites: ChainedEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  
  constructor(config: S3Config) {
    this.config = config;
  }
  
  async initialize(session: SessionEnvelope): Promise<void> {
    this.session = session;
    this.entries = [];
    this.pendingWrites = [];
    
    // Start periodic flush
    this.flushInterval = setInterval(() => { void this.flush(); }, 5000);
    
    // Write session metadata
    await this.putObject(
      `${session.org_id}/${session.session_id}/session.json`,
      JSON.stringify(session)
    );
  }
  
  async append(entry: AuditEntry): Promise<ChainedEntry> {
    const lastEntry = this.entries[this.entries.length - 1];
    const previousHash = lastEntry ? lastEntry.entry_hash : '';
    
    const chained = createChainedEntry(entry, this.entries.length, previousHash);
    this.entries.push(chained);
    this.pendingWrites.push(chained);
    
    // Flush if buffer is large
    if (this.pendingWrites.length >= 100) {
      await this.flush();
    }
    
    return chained;
  }
  
  private async flush(): Promise<void> {
    if (this.pendingWrites.length === 0) return;
    
    const batch = this.pendingWrites.splice(0);
    const firstEntry = batch[0];
    const lastEntry = batch[batch.length - 1];
    if (!firstEntry || !lastEntry) return;

    const startSeq = firstEntry.sequence;
    const endSeq = lastEntry.sequence;
    
    await this.putObject(
      `${this.session.org_id}/${this.session.session_id}/entries/${startSeq}-${endSeq}.jsonl`,
      batch.map(e => JSON.stringify(e)).join('\n')
    );
  }
  
  async getRange(start: number, end: number): Promise<ChainedEntry[]> {
    return this.entries.slice(start, end);
  }
  
  async getAll(): Promise<ChainedEntry[]> {
    return [...this.entries];
  }
  
  async count(): Promise<number> {
    return this.entries.length;
  }
  
  async verify(): Promise<{ valid: boolean; errors: string[] }> {
    const result = verifyChain(this.entries);
    return { valid: result.valid, errors: result.errors };
  }
  
  async close(privateKey?: string, publicKey?: string): Promise<AuditLog> {
    // Stop flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    // Final flush
    await this.flush();
    
    const hashes = this.entries.map(e => e.entry_hash);
    const { root } = buildMerkleTree(hashes);
    
    const closedSession: SessionEnvelope = {
      ...this.session,
      closed_at: timestamp(),
    };
    
    const log: AuditLog = {
      version: '1.0.0',
      session: closedSession,
      entries: this.entries,
      merkle_root: root,
    };
    
    if (privateKey && publicKey) {
      log.org_signature = signAuditLog(log, privateKey, publicKey);
    }
    
    const verification = verifyChain(this.entries);
    log.integrity = {
      chain_valid: verification.valid,
      merkle_valid: true,
      signature_valid: log.org_signature ? verifyAuditLogSignature(log) : undefined,
      verified_at: timestamp(),
    };
    
    // Write final log
    await this.putObject(
      `${this.session.org_id}/${this.session.session_id}/audit.final.json`,
      JSON.stringify(log)
    );
    
    return log;
  }
  
  async export(options: ExportOptions): Promise<Buffer> {
    const log = await this.close();
    return exportAuditLog(log, options);
  }
  
  getSession(): SessionEnvelope {
    return this.session;
  }
  
  // Simplified S3 operations (would use AWS SDK in production)
  private async putObject(key: string, body: string): Promise<void> {
    const url = `${this.config.endpoint}/${this.config.bucket}/${key}`;
    
    // In production, use proper AWS Signature V4
    // This is a placeholder for the interface
    await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      },
      body,
    });
  }
}

// ============================================================================
// EXPORT UTILITIES
// ============================================================================

function exportAuditLog(log: AuditLog, options: ExportOptions): Buffer {
  switch (options.format) {
    case 'jsonl':
      return exportJsonl(log, options);
    case 'splunk_cim':
      return exportSplunkCIM(log, options);
    case 'elastic_ecs':
      return exportElasticECS(log, options);
    case 'finra_4511':
      return exportFINRA4511(log, options);
    case 'eu_ai_act':
      return exportEUAIAct(log, options);
    default:
      return exportJsonl(log, options);
  }
}

function exportJsonl(log: AuditLog, _options: ExportOptions): Buffer {
  const lines = [
    JSON.stringify({ type: 'session', ...log.session }),
    ...log.entries.map(e => JSON.stringify({ type: 'entry', ...e })),
    JSON.stringify({ type: 'integrity', ...log.integrity }),
  ];
  return Buffer.from(lines.join('\n'));
}

function exportSplunkCIM(log: AuditLog, _options: ExportOptions): Buffer {
  // Splunk Common Information Model format
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
      entry_hash: entry.entry_hash,
      ...entry.entry,
    },
  }));
  
  return Buffer.from(events.map(e => JSON.stringify(e)).join('\n'));
}

function exportElasticECS(log: AuditLog, _options: ExportOptions): Buffer {
  // Elastic Common Schema format
  const docs = log.entries.map(entry => ({
    '@timestamp': entry.entry.timestamp,
    'ecs.version': '8.0.0',
    'event.kind': 'event',
    'event.category': ['process'],
    'event.type': ['info'],
    'event.action': entry.entry.type,
    'event.id': entry.entry.entry_id,
    'event.sequence': entry.sequence,
    'agent.id': log.session.agent_id,
    'organization.id': log.session.org_id,
    'session.id': log.session.session_id,
    'hash.sha256': entry.entry_hash,
    'agentledger': entry.entry,
  }));
  
  return Buffer.from(docs.map(d => JSON.stringify(d)).join('\n'));
}

function exportFINRA4511(log: AuditLog, _options: ExportOptions): Buffer {
  // FINRA Rule 4511 (Books and Records) format
  // Requires: exact reproduction, timestamps, sequence preservation
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
      previous_hash: entry.previous_hash,
      data: entry.entry,
    })),
  };
  
  return Buffer.from(JSON.stringify(record, null, 2));
}

function exportEUAIAct(log: AuditLog, _options: ExportOptions): Buffer {
  // EU AI Act Article 12 (Record-keeping) format
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
      environment: log.session.environment,
      initiator: log.session.initiated_by,
    },
    traceability: {
      total_events: log.entries.length,
      merkle_root: log.merkle_root,
      chain_integrity: log.integrity?.chain_valid,
    },
    events: log.entries.map(entry => {
      const base = {
        event_id: entry.entry.entry_id,
        timestamp: entry.entry.timestamp,
        event_type: entry.entry.type,
        hash: entry.entry_hash,
      };
      
      // Add type-specific fields for explainability
      if (entry.entry.type === 'model_call') {
        return {
          ...base,
          model: entry.entry.model_id,
          provider: entry.entry.provider,
          tokens_used: entry.entry.prompt_tokens + entry.entry.completion_tokens,
        };
      }
      
      if (entry.entry.type === 'decision_point') {
        return {
          ...base,
          decision_category: entry.entry.category,
          options_count: entry.entry.options_considered.length,
          human_review_required: entry.entry.human_review_required,
        };
      }
      
      if (entry.entry.type === 'human_approval') {
        return {
          ...base,
          approver_role: entry.entry.approver_role,
          approval_type: entry.entry.approval_type,
        };
      }
      
      return base;
    }),
    compliance_metadata: {
      retention_days: log.session.retention_days,
      applicable_frameworks: log.session.compliance_contexts,
      export_timestamp: new Date().toISOString(),
    },
  };
  
  return Buffer.from(JSON.stringify(record, null, 2));
}
