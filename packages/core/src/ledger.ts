/**
 * AgentLedger - Main API
 * High-level interface for AI agent audit logging.
 */

import type {
  SessionEnvelope,
  AuditEntry,
  ModelCall,
  ToolInvocation,
  DecisionPoint,
  HumanApproval,
  StateSnapshot,
  ContentReference,
  ChainedEntry,
  AuditLog,
  ComplianceContext,
  ExportOptions,
} from './types';
import { StorageBackend, InMemoryStorage, FileSystemStorage, S3Storage, S3Config } from './storage';
import { generateId, timestamp, hashContent, generateKeyPair } from './crypto';
import { LedgerNotInitializedError } from './errors';

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface LedgerConfig {
  /** Organization identifier */
  orgId: string;
  
  /** Agent/application identifier */
  agentId: string;
  
  /** Agent version */
  agentVersion?: string;
  
  /** Deployment environment */
  environment: 'production' | 'staging' | 'development' | 'test';
  
  /** Applicable compliance frameworks */
  compliance: ComplianceContext[];
  
  /** Retention period in days (default: 2555 = 7 years) */
  retentionDays?: number;
  
  /** Storage backend */
  storage?: StorageBackend | 'memory' | { type: 'filesystem'; path: string } | { type: 's3'; config: S3Config };
  
  /** Auto-snapshot interval (entries between snapshots) */
  snapshotInterval?: number;
  
  /** Keys for signing (optional) */
  signingKeys?: {
    publicKey: string;
    privateKey: string;
  };
}

// ============================================================================
// LEDGER CLASS
// ============================================================================

export class Ledger {
  private storage: StorageBackend;
  private config: LedgerConfig;
  private initialized: boolean = false;
  private entryCount: number = 0;
  private signingKeys?: { publicKey: string; privateKey: string };
  
  constructor(config: LedgerConfig) {
    this.config = config;
    this.signingKeys = config.signingKeys;
    
    // Initialize storage backend
    if (!config.storage || config.storage === 'memory') {
      this.storage = new InMemoryStorage();
    } else if (typeof config.storage === 'object' && 'type' in config.storage) {
      if (config.storage.type === 'filesystem') {
        this.storage = new FileSystemStorage(config.storage.path);
      } else if (config.storage.type === 's3') {
        this.storage = new S3Storage(config.storage.config);
      } else {
        this.storage = new InMemoryStorage();
      }
    } else {
      this.storage = config.storage;
    }
  }
  
  /**
   * Start a new audit session
   */
  async start(initiatedBy: SessionEnvelope['initiated_by'], metadata?: Record<string, unknown>): Promise<string> {
    const session: SessionEnvelope = {
      session_id: generateId(),
      org_id: this.config.orgId,
      agent_id: this.config.agentId,
      agent_version: this.config.agentVersion,
      environment: this.config.environment,
      initiated_by: initiatedBy,
      initiated_at: timestamp(),
      compliance_contexts: this.config.compliance,
      retention_days: this.config.retentionDays ?? 2555,
      metadata,
    };
    
    await this.storage.initialize(session);
    this.initialized = true;
    this.entryCount = 0;
    
    return session.session_id;
  }
  
  /**
   * Log a model call
   */
  async logModelCall(params: {
    provider: ModelCall['provider'];
    modelId: string;
    modelVersion?: string;
    parameters?: ModelCall['parameters'];
    promptHash: string;
    promptTokens: number;
    completionHash: string;
    completionTokens: number;
    latencyMs: number;
    costUsd?: number;
    streamed?: boolean;
    cacheStatus?: ModelCall['cache_status'];
    error?: ModelCall['error'];
  }): Promise<ChainedEntry> {
    this.ensureInitialized();
    
    const entry: ModelCall = {
      type: 'model_call',
      entry_id: generateId(),
      timestamp: timestamp(),
      provider: params.provider,
      model_id: params.modelId,
      model_version: params.modelVersion,
      parameters: params.parameters ?? {},
      prompt_hash: params.promptHash,
      prompt_tokens: params.promptTokens,
      completion_hash: params.completionHash,
      completion_tokens: params.completionTokens,
      latency_ms: params.latencyMs,
      cost_usd: params.costUsd,
      streamed: params.streamed ?? false,
      cache_status: params.cacheStatus,
      error: params.error,
    };
    
    return this.append(entry);
  }
  
  /**
   * Log a tool invocation
   */
  async logToolInvocation(params: {
    toolName: string;
    toolVersion?: string;
    requestedBy?: string;
    inputHash: string;
    inputSchemaRef?: string;
    outputHash: string;
    durationMs: number;
    success: boolean;
    error?: ToolInvocation['error'];
    resourcesAccessed?: ToolInvocation['resources_accessed'];
  }): Promise<ChainedEntry> {
    this.ensureInitialized();
    
    const entry: ToolInvocation = {
      type: 'tool_invocation',
      entry_id: generateId(),
      timestamp: timestamp(),
      tool_name: params.toolName,
      tool_version: params.toolVersion,
      requested_by: params.requestedBy,
      input_hash: params.inputHash,
      input_schema_ref: params.inputSchemaRef,
      output_hash: params.outputHash,
      duration_ms: params.durationMs,
      success: params.success,
      error: params.error,
      resources_accessed: params.resourcesAccessed,
    };
    
    return this.append(entry);
  }
  
  /**
   * Log a decision point
   */
  async logDecision(params: {
    decisionId: string;
    category: DecisionPoint['category'];
    optionsConsidered: DecisionPoint['options_considered'];
    selectedOption: string;
    reasoningHash: string;
    confidenceScore?: number;
    humanReviewRequired?: boolean;
    triggeredBy?: DecisionPoint['triggered_by'];
  }): Promise<ChainedEntry> {
    this.ensureInitialized();
    
    const entry: DecisionPoint = {
      type: 'decision_point',
      entry_id: generateId(),
      timestamp: timestamp(),
      decision_id: params.decisionId,
      category: params.category,
      options_considered: params.optionsConsidered,
      selected_option: params.selectedOption,
      reasoning_hash: params.reasoningHash,
      confidence_score: params.confidenceScore,
      human_review_required: params.humanReviewRequired ?? false,
      triggered_by: params.triggeredBy,
    };
    
    return this.append(entry);
  }
  
  /**
   * Log a human approval
   */
  async logApproval(params: {
    approverId: string;
    approverRole: string;
    decisionRef: string;
    approvalType: HumanApproval['approval_type'];
    modificationHash?: string;
    commentHash?: string;
    attestationSignature?: string;
    reviewDurationSeconds?: number;
  }): Promise<ChainedEntry> {
    this.ensureInitialized();
    
    const entry: HumanApproval = {
      type: 'human_approval',
      entry_id: generateId(),
      timestamp: timestamp(),
      approver_id: params.approverId,
      approver_role: params.approverRole,
      decision_ref: params.decisionRef,
      approval_type: params.approvalType,
      modification_hash: params.modificationHash,
      comment_hash: params.commentHash,
      attestation_signature: params.attestationSignature,
      review_duration_seconds: params.reviewDurationSeconds,
    };
    
    return this.append(entry);
  }
  
  /**
   * Take a state snapshot
   */
  async snapshot(params: {
    trigger: StateSnapshot['trigger'];
    stateHash: string;
    schemaVersion: string;
    metrics?: StateSnapshot['metrics'];
  }): Promise<ChainedEntry> {
    this.ensureInitialized();
    
    const entry: StateSnapshot = {
      type: 'state_snapshot',
      entry_id: generateId(),
      timestamp: timestamp(),
      trigger: params.trigger,
      state_hash: params.stateHash,
      schema_version: params.schemaVersion,
      metrics: params.metrics,
    };
    
    return this.append(entry);
  }
  
  /**
   * Store content reference (for external content storage)
   */
  async storeContent(params: {
    contentType: ContentReference['content_type'];
    parentEntryId: string;
    content: string | Buffer;
    storageUri?: string;
    containsPii?: boolean;
    piiTypes?: ContentReference['pii_types'];
  }): Promise<ChainedEntry> {
    this.ensureInitialized();
    
    const contentBuffer = typeof params.content === 'string' 
      ? Buffer.from(params.content) 
      : params.content;
    
    const entry: ContentReference = {
      type: 'content_reference',
      entry_id: generateId(),
      timestamp: timestamp(),
      content_type: params.contentType,
      parent_entry_id: params.parentEntryId,
      content_hash: hashContent(contentBuffer),
      size_bytes: contentBuffer.length,
      storage_uri: params.storageUri,
      contains_pii: params.containsPii ?? false,
      pii_types: params.piiTypes,
    };
    
    return this.append(entry);
  }
  
  /**
   * Append a raw entry
   */
  private async append(entry: AuditEntry): Promise<ChainedEntry> {
    const chained = await this.storage.append(entry);
    this.entryCount++;
    
    // Auto-snapshot if configured
    if (this.config.snapshotInterval && this.entryCount % this.config.snapshotInterval === 0) {
      await this.snapshot({
        trigger: 'periodic',
        stateHash: hashContent(JSON.stringify({ count: this.entryCount })),
        schemaVersion: '1.0.0',
      });
    }
    
    return chained;
  }
  
  /**
   * Verify chain integrity
   */
  async verify(): Promise<{ valid: boolean; errors: string[] }> {
    this.ensureInitialized();
    return this.storage.verify();
  }
  
  /**
   * Get entries in range
   */
  async getEntries(start?: number, end?: number): Promise<ChainedEntry[]> {
    this.ensureInitialized();
    if (start !== undefined && end !== undefined) {
      return this.storage.getRange(start, end);
    }
    return this.storage.getAll();
  }
  
  /**
   * Get entry count
   */
  async count(): Promise<number> {
    this.ensureInitialized();
    return this.storage.count();
  }
  
  /**
   * Close the session and finalize the log
   */
  async close(): Promise<AuditLog> {
    this.ensureInitialized();
    return this.storage.close(
      this.signingKeys?.privateKey,
      this.signingKeys?.publicKey
    );
  }
  
  /**
   * Export to a specific format
   */
  async export(options: ExportOptions): Promise<Buffer> {
    this.ensureInitialized();
    return this.storage.export(options);
  }
  
  /**
   * Get current session info
   */
  getSession(): SessionEnvelope {
    this.ensureInitialized();
    return this.storage.getSession();
  }
  
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new LedgerNotInitializedError();
    }
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a new ledger with default configuration
 */
export function createLedger(config: LedgerConfig): Ledger {
  return new Ledger(config);
}

/**
 * Generate signing keys for attestation
 */
export function generateSigningKeys(): { publicKey: string; privateKey: string } {
  return generateKeyPair();
}

/**
 * Hash content for storage
 */
export { hashContent } from './crypto';

/**
 * Generate a unique ID
 */
export { generateId } from './crypto';
