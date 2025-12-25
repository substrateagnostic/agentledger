# AgentLedger Architecture

This document describes the high-level architecture of AgentLedger, a compliance-ready audit logging SDK for AI agents.

## Overview

AgentLedger provides structured, tamper-evident audit logging for AI agents operating in regulated industries. It supports compliance frameworks including FINRA 4511/3110, EU AI Act, HIPAA, and SOC2.

## Design Principles

1. **Immutability**: All audit entries are cryptographically chained and immutable once recorded
2. **Compliance-First**: Built to meet regulatory requirements from the ground up
3. **Provider-Agnostic**: Works with any LLM provider (OpenAI, Anthropic, etc.)
4. **Privacy-Aware**: Hash-based logging protects sensitive content while maintaining auditability
5. **Extensible**: Pluggable storage backends and export formats

## Package Structure

```
packages/
├── core/           # Core audit logging functionality
├── openai/         # OpenAI SDK integration
├── anthropic/      # Anthropic SDK integration
├── langchain/      # LangChain callback integration
└── cli/            # Command-line interface tools
```

### agentledger-core

The core package provides the foundational audit logging capabilities:

```
packages/core/src/
├── types.ts        # TypeScript type definitions
├── errors.ts       # Custom error classes
├── validation.ts   # Input validation utilities
├── crypto.ts       # Cryptographic operations
├── storage.ts      # Storage backend implementations
├── ledger.ts       # Main Ledger API
└── index.ts        # Public exports
```

#### Key Components

**Ledger Class** (`ledger.ts`)
- Main API for recording audit entries
- Manages session lifecycle
- Handles entry chaining and signing

**Storage Backends** (`storage.ts`)
- `InMemoryStorage`: For testing and development
- `FileSystemStorage`: Local file persistence
- `S3Storage`: AWS S3 cloud storage

**Cryptographic Operations** (`crypto.ts`)
- SHA-256 hashing for content and entries
- Ed25519 signing for tamper detection
- Merkle tree generation for efficient verification
- Chain linking with previous entry hashes

### agentledger-openai

Wraps the OpenAI SDK to automatically log all API calls:

```typescript
import { AuditedOpenAI } from 'agentledger-openai';

const client = new AuditedOpenAI(openaiClient, { ledger });
const response = await client.chat.completions.create({...});
// Automatically logged to ledger
```

### agentledger-anthropic

Wraps the Anthropic SDK for automatic audit logging:

```typescript
import { AuditedAnthropic } from 'agentledger-anthropic';

const client = new AuditedAnthropic(anthropicClient, { ledger });
const message = await client.messages.create({...});
// Automatically logged to ledger
```

### agentledger-langchain

Provides a LangChain callback handler for logging:

```typescript
import { AgentLedgerCallbackHandler } from 'agentledger-langchain';

const handler = new AgentLedgerCallbackHandler(ledger);
const chain = new LLMChain({..., callbacks: [handler]});
```

### agentledger-cli

Command-line tools for working with audit logs:

```bash
agentledger verify log.jsonl      # Verify chain integrity
agentledger export log.jsonl      # Export to compliance format
agentledger replay log.jsonl      # Replay session timeline
agentledger summary log.jsonl     # Show session summary
```

## Data Model

### Session Envelope

Every audit session starts with a session envelope:

```typescript
interface SessionEnvelope {
  session_id: string;           // UUID v4
  created_at: string;           // ISO 8601 timestamp
  org_id: string;               // Organization identifier
  agent_id: string;             // Agent identifier
  agent_version: string;        // Semantic version
  environment: string;          // e.g., 'production', 'staging'
  initiated_by: ActorRef;       // Who started the session
  compliance_context: {
    frameworks: string[];       // e.g., ['FINRA_4511', 'EU_AI_ACT']
    retention_period_days: number;
    jurisdiction?: string;
  };
}
```

### Audit Entries

The system supports several entry types:

1. **ModelCall**: LLM API invocations
   - Provider, model ID, parameters
   - Prompt/completion hashes
   - Token counts and latency
   - Cost estimates

2. **ToolInvocation**: Tool/function calls
   - Tool name and input/output hashes
   - Duration and success status
   - Resources accessed

3. **DecisionPoint**: Key decision moments
   - Decision type and inputs
   - Rationale and output
   - Human review requirements

4. **HumanApproval**: Human-in-the-loop approvals
   - Approver identity
   - Decision status
   - Comments and conditions

5. **StateSnapshot**: Periodic state captures
   - Key metrics and active resources
   - Checkpoint data for recovery

6. **ContentReference**: Content storage references
   - Hashed content with optional PII flags
   - Links to parent entries

### Hash Chain

Each entry is linked to the previous entry via hash chaining:

```typescript
interface ChainedEntry {
  entry: AuditEntry;
  entry_hash: string;           // SHA-256 of entry
  prev_entry_hash: string;      // Hash of previous entry
  sequence_number: number;      // Monotonic counter
  signature?: string;           // Optional Ed25519 signature
}
```

This ensures:
- Tamper detection (any modification breaks the chain)
- Ordering guarantees (sequence numbers are monotonic)
- Non-repudiation (signatures prove origin)

## Security Model

### Content Protection

By default, AgentLedger only stores content hashes, not raw content:

```typescript
// Only the hash is stored in the audit log
promptHash: hashContent(JSON.stringify(messages))

// Full content can optionally be stored separately
if (storeContent) {
  await ledger.storeContent({
    contentType: 'prompt',
    content: JSON.stringify(messages),
  });
}
```

### Signature Verification

Ed25519 signatures provide:
- Authenticity: Proves who created the entry
- Integrity: Detects any modifications
- Non-repudiation: Signer cannot deny creating the entry

```typescript
const { publicKey, privateKey } = await generateSigningKeys();

// Sign during logging
const ledger = new Ledger({
  signingKey: privateKey,
  ...config
});

// Verify later
const isValid = await verifyAuditLogSignature(log, publicKey);
```

### Storage Security

Storage backends should implement:
- Encryption at rest
- Access control
- Audit logging of access
- Geographic restrictions (for compliance)

## Export Formats

AgentLedger supports multiple compliance-ready export formats:

| Format | Use Case |
|--------|----------|
| `jsonl` | Raw format, line-delimited JSON |
| `splunk_cim` | Splunk Common Information Model |
| `elastic_ecs` | Elastic Common Schema |
| `finra_4511` | FINRA Rule 4511 compliance |
| `eu_ai_act` | EU AI Act requirements |

## Performance Considerations

### Async-First

All operations are async to avoid blocking:

```typescript
// Non-blocking logging
await ledger.logModelCall({...});

// Batch exports
const entries = await ledger.getEntries({ start: 0, end: 1000 });
```

### Auto-Snapshots

Periodic snapshots can be configured for long-running sessions:

```typescript
const ledger = new Ledger({
  autoSnapshotInterval: 100,  // Every 100 entries
  ...config
});
```

### Streaming Support

SDK wrappers handle streaming responses transparently:

```typescript
const stream = await client.chat.completions.create({
  ...params,
  stream: true,
});

// Content is accumulated and logged after stream completes
for await (const chunk of stream) {
  // Process chunks...
}
```

## Extensibility

### Custom Storage Backends

Implement the `StorageBackend` interface:

```typescript
interface StorageBackend {
  initialize(session: SessionEnvelope): Promise<void>;
  append(entry: ChainedEntry): Promise<void>;
  getRange(start: number, end: number): Promise<ChainedEntry[]>;
  getAll(): Promise<ChainedEntry[]>;
  count(): Promise<number>;
  verify(): Promise<boolean>;
  close(): Promise<void>;
}
```

### Custom Cost Calculators

Override default pricing with custom calculators:

```typescript
const client = new AuditedOpenAI(openaiClient, {
  ledger,
  costCalculator: (model, promptTokens, completionTokens) => {
    // Custom pricing logic
    return customCost;
  },
});
```

## Testing

The project uses Jest for testing:

```bash
npm test                    # Run all tests
npm run test:coverage       # With coverage report
```

Test coverage requirements:
- Core package: 80%+ coverage
- Integration packages: Unit tests for wrappers
- CLI: Integration tests for commands

## Future Considerations

1. **Real-time streaming**: WebSocket-based streaming to monitoring systems
2. **Distributed tracing**: OpenTelemetry integration for distributed agents
3. **Multi-agent support**: Correlation across multiple cooperating agents
4. **Compliance reporting**: Automated compliance report generation
5. **Retention policies**: Automatic archival and deletion based on policies
