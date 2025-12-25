/**
 * AgentLedger Core Types
 * Structured logging schema for AI agent accountability in regulated industries.
 * 
 * Supports: FINRA 4511/3110, EU AI Act Article 12, HIPAA, SOC2
 */

import { z } from 'zod';

// ============================================================================
// COMPLIANCE CONTEXTS
// ============================================================================

export const ComplianceContext = z.enum([
  'FINRA_4511',    // Financial services - books and records
  'FINRA_3110',    // Financial services - supervision
  'EU_AI_ACT',     // European AI regulation
  'HIPAA',         // Healthcare privacy
  'SOC2',          // Service organization controls
  'GDPR',          // General data protection
  'CCPA',          // California consumer privacy
  'CUSTOM'         // Organization-specific
]);

export type ComplianceContext = z.infer<typeof ComplianceContext>;

// ============================================================================
// SESSION ENVELOPE
// ============================================================================

export const SessionEnvelope = z.object({
  /** Unique identifier for this audit session */
  session_id: z.string().uuid(),
  
  /** Organization identifier */
  org_id: z.string().min(1),
  
  /** Agent/application identifier */
  agent_id: z.string().min(1),
  
  /** Agent version for reproducibility */
  agent_version: z.string().optional(),
  
  /** Deployment environment */
  environment: z.enum(['production', 'staging', 'development', 'test']),
  
  /** Who/what initiated this session */
  initiated_by: z.object({
    type: z.enum(['user', 'system', 'scheduled', 'api']),
    identifier: z.string(),
    ip_address: z.string().ip().optional(),
    user_agent: z.string().optional(),
  }),
  
  /** Session start timestamp (ISO 8601) */
  initiated_at: z.string().datetime(),
  
  /** Session end timestamp (ISO 8601) */
  closed_at: z.string().datetime().optional(),
  
  /** Applicable compliance frameworks */
  compliance_contexts: z.array(ComplianceContext),
  
  /** Retention policy in days */
  retention_days: z.number().int().positive().default(2555), // 7 years FINRA default
  
  /** Custom metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SessionEnvelope = z.infer<typeof SessionEnvelope>;

// ============================================================================
// MODEL CALL
// ============================================================================

export const ModelCall = z.object({
  /** Entry type discriminator */
  type: z.literal('model_call'),
  
  /** Unique entry identifier */
  entry_id: z.string().uuid(),
  
  /** Timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
  
  /** Model provider */
  provider: z.enum(['openai', 'anthropic', 'google', 'azure', 'bedrock', 'custom']),
  
  /** Model identifier */
  model_id: z.string(),
  
  /** Model version/snapshot if available */
  model_version: z.string().optional(),
  
  /** Request parameters */
  parameters: z.object({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    max_tokens: z.number().optional(),
    stop_sequences: z.array(z.string()).optional(),
    system_prompt_hash: z.string().optional(),
  }),
  
  /** SHA-256 hash of the full prompt/messages */
  prompt_hash: z.string(),
  
  /** Token counts */
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  
  /** SHA-256 hash of the completion */
  completion_hash: z.string(),
  
  /** Response latency in milliseconds */
  latency_ms: z.number().nonnegative(),
  
  /** Estimated cost in USD */
  cost_usd: z.number().nonnegative().optional(),
  
  /** Whether response was streamed */
  streamed: z.boolean().default(false),
  
  /** Cache status */
  cache_status: z.enum(['hit', 'miss', 'disabled']).optional(),
  
  /** Error if call failed */
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
});

export type ModelCall = z.infer<typeof ModelCall>;

// ============================================================================
// TOOL INVOCATION
// ============================================================================

export const ToolInvocation = z.object({
  /** Entry type discriminator */
  type: z.literal('tool_invocation'),
  
  /** Unique entry identifier */
  entry_id: z.string().uuid(),
  
  /** Timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
  
  /** Tool name */
  tool_name: z.string(),
  
  /** Tool version */
  tool_version: z.string().optional(),
  
  /** Reference to the model call that requested this tool */
  requested_by: z.string().uuid().optional(),
  
  /** SHA-256 hash of tool input */
  input_hash: z.string(),
  
  /** JSON Schema reference for input validation */
  input_schema_ref: z.string().optional(),
  
  /** SHA-256 hash of tool output */
  output_hash: z.string(),
  
  /** Execution duration in milliseconds */
  duration_ms: z.number().nonnegative(),
  
  /** Success status */
  success: z.boolean(),
  
  /** Error details if failed */
  error: z.object({
    code: z.string(),
    message: z.string(),
    stack_trace_hash: z.string().optional(),
  }).optional(),
  
  /** Resource access during tool execution */
  resources_accessed: z.array(z.object({
    type: z.enum(['database', 'api', 'file', 'network', 'memory']),
    identifier: z.string(),
    operation: z.enum(['read', 'write', 'delete', 'execute']),
  })).optional(),
});

export type ToolInvocation = z.infer<typeof ToolInvocation>;

// ============================================================================
// DECISION POINT
// ============================================================================

export const DecisionPoint = z.object({
  /** Entry type discriminator */
  type: z.literal('decision_point'),
  
  /** Unique entry identifier */
  entry_id: z.string().uuid(),
  
  /** Timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
  
  /** Decision identifier for reference */
  decision_id: z.string(),
  
  /** Decision category */
  category: z.enum([
    'routing',           // Which path/agent to use
    'tool_selection',    // Which tool to invoke
    'response_type',     // How to respond
    'escalation',        // Whether to escalate
    'termination',       // Whether to end session
    'content_filter',    // Content moderation decision
    'custom'
  ]),
  
  /** Options that were considered */
  options_considered: z.array(z.object({
    option_id: z.string(),
    description: z.string(),
    score: z.number().optional(),
  })),
  
  /** Selected option */
  selected_option: z.string(),
  
  /** SHA-256 hash of reasoning/rationale */
  reasoning_hash: z.string(),
  
  /** Confidence score (0-1) */
  confidence_score: z.number().min(0).max(1).optional(),
  
  /** Whether human review is required */
  human_review_required: z.boolean().default(false),
  
  /** Threshold that triggered this decision */
  triggered_by: z.object({
    type: z.enum(['confidence', 'policy', 'user_request', 'system']),
    threshold: z.number().optional(),
    policy_id: z.string().optional(),
  }).optional(),
});

export type DecisionPoint = z.infer<typeof DecisionPoint>;

// ============================================================================
// HUMAN APPROVAL
// ============================================================================

export const HumanApproval = z.object({
  /** Entry type discriminator */
  type: z.literal('human_approval'),
  
  /** Unique entry identifier */
  entry_id: z.string().uuid(),
  
  /** Timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
  
  /** Approver identifier */
  approver_id: z.string(),
  
  /** Approver role/title */
  approver_role: z.string(),
  
  /** Reference to the decision point being approved */
  decision_ref: z.string().uuid(),
  
  /** Approval type */
  approval_type: z.enum(['APPROVE', 'REJECT', 'MODIFY', 'ESCALATE', 'DEFER']),
  
  /** SHA-256 hash of any modifications made */
  modification_hash: z.string().optional(),
  
  /** Comment/rationale */
  comment_hash: z.string().optional(),
  
  /** Ed25519 signature of the approval */
  attestation_signature: z.string().optional(),
  
  /** Time spent reviewing (seconds) */
  review_duration_seconds: z.number().nonnegative().optional(),
});

export type HumanApproval = z.infer<typeof HumanApproval>;

// ============================================================================
// STATE SNAPSHOT
// ============================================================================

export const StateSnapshot = z.object({
  /** Entry type discriminator */
  type: z.literal('state_snapshot'),
  
  /** Unique entry identifier */
  entry_id: z.string().uuid(),
  
  /** Timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
  
  /** Snapshot trigger */
  trigger: z.enum(['checkpoint', 'decision', 'error', 'manual', 'periodic']),
  
  /** SHA-256 hash of the full state */
  state_hash: z.string(),
  
  /** State schema version */
  schema_version: z.string(),
  
  /** Key metrics at this point */
  metrics: z.object({
    total_tokens: z.number().int().nonnegative(),
    total_cost_usd: z.number().nonnegative(),
    total_tool_calls: z.number().int().nonnegative(),
    total_decisions: z.number().int().nonnegative(),
    error_count: z.number().int().nonnegative(),
  }).optional(),
});

export type StateSnapshot = z.infer<typeof StateSnapshot>;

// ============================================================================
// CONTENT REFERENCE
// ============================================================================

export const ContentReference = z.object({
  /** Entry type discriminator */
  type: z.literal('content_reference'),
  
  /** Unique entry identifier */
  entry_id: z.string().uuid(),
  
  /** Timestamp (ISO 8601) */
  timestamp: z.string().datetime(),
  
  /** Content type */
  content_type: z.enum(['prompt', 'completion', 'tool_input', 'tool_output', 'state', 'reasoning', 'modification', 'comment']),
  
  /** Reference to the entry this content belongs to */
  parent_entry_id: z.string().uuid(),
  
  /** SHA-256 hash of the content */
  content_hash: z.string(),
  
  /** Content size in bytes */
  size_bytes: z.number().int().nonnegative(),
  
  /** Storage location (for external storage) */
  storage_uri: z.string().optional(),
  
  /** Whether content contains PII (for redaction) */
  contains_pii: z.boolean().default(false),
  
  /** PII types detected */
  pii_types: z.array(z.enum([
    'name', 'email', 'phone', 'ssn', 'address', 'dob', 'financial', 'medical', 'other'
  ])).optional(),
});

export type ContentReference = z.infer<typeof ContentReference>;

// ============================================================================
// UNION TYPE FOR ALL ENTRIES
// ============================================================================

export const AuditEntry = z.discriminatedUnion('type', [
  ModelCall,
  ToolInvocation,
  DecisionPoint,
  HumanApproval,
  StateSnapshot,
  ContentReference,
]);

export type AuditEntry = z.infer<typeof AuditEntry>;

// ============================================================================
// CHAINED ENTRY (with cryptographic linking)
// ============================================================================

export const ChainedEntry = z.object({
  /** Sequence number in the chain */
  sequence: z.number().int().nonnegative(),
  
  /** The audit entry */
  entry: AuditEntry,
  
  /** SHA-256 hash of previous entry (empty string for first entry) */
  previous_hash: z.string(),
  
  /** SHA-256 hash of this entry (includes previous_hash) */
  entry_hash: z.string(),
  
  /** Merkle tree position data */
  merkle: z.object({
    leaf_hash: z.string(),
    tree_size: z.number().int().positive(),
  }).optional(),
});

export type ChainedEntry = z.infer<typeof ChainedEntry>;

// ============================================================================
// COMPLETE AUDIT LOG
// ============================================================================

export const AuditLog = z.object({
  /** Log format version */
  version: z.literal('1.0.0'),
  
  /** Session envelope */
  session: SessionEnvelope,
  
  /** Chained entries */
  entries: z.array(ChainedEntry),
  
  /** Merkle root (computed on close) */
  merkle_root: z.string().optional(),
  
  /** Organization signature (Ed25519) */
  org_signature: z.object({
    public_key: z.string(),
    signature: z.string(),
    signed_at: z.string().datetime(),
  }).optional(),
  
  /** Verification status */
  integrity: z.object({
    chain_valid: z.boolean(),
    merkle_valid: z.boolean(),
    signature_valid: z.boolean().optional(),
    verified_at: z.string().datetime(),
  }).optional(),
});

export type AuditLog = z.infer<typeof AuditLog>;

// ============================================================================
// EXPORT TYPES
// ============================================================================

export type ExportFormat = 
  | 'jsonl'           // Raw JSONL
  | 'parquet'         // Columnar format
  | 'splunk_cim'      // Splunk Common Information Model
  | 'elastic_ecs'     // Elastic Common Schema
  | 'servicenow_grc'  // ServiceNow GRC
  | 'onetrust'        // OneTrust format
  | 'finra_4511'      // FINRA books and records
  | 'eu_ai_act'       // EU AI Act Article 12

export interface ExportOptions {
  format: ExportFormat;
  include_content?: boolean;
  redact_pii?: boolean;
  date_range?: {
    start: Date;
    end: Date;
  };
  compress?: boolean;
}
