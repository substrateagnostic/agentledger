# AgentLedger

**Compliance-Ready Audit Trails for AI Agents**

[![npm version](https://badge.fury.io/js/agentledger-core.svg)](https://badge.fury.io/js/agentledger-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://github.com/substrateagnostic/agentledger/actions/workflows/ci.yml/badge.svg)](https://github.com/substrateagnostic/agentledger/actions)
[![Hacktoberfest](https://img.shields.io/badge/Hacktoberfest-friendly-blueviolet)](https://hacktoberfest.com)

> Created by [Alex Galle-From](https://alexgallefrom.io) | [substrateagnostic](https://github.com/substrateagnostic)

AgentLedger is an SDK for building tamper-evident, compliance-ready audit trails for AI agents in regulated industries. Think "OpenTelemetry for AI accountability."

## The Problem

Organizations deploying AI agents in regulated contexts face emerging accountability requirements:

- **FINRA 4511/3110**: Financial services must reproduce data "exactly as it was at specific points in time"
- **EU AI Act Article 12**: High-risk AI systems require automatic logging of events
- **HIPAA**: Healthcare AI must maintain audit trails with PHI protection
- **SOC 2**: Service organizations need evidence of AI governance controls

No uniform standardized logging exists. 

## Quick Start

```bash
npm install agentledger-core agentledger-openai
```

```typescript
import { createLedger } from 'agentledger-core';
import { createAuditedOpenAI } from 'agentledger-openai';
import OpenAI from 'openai';

// Create audit ledger
const ledger = createLedger({
  orgId: 'acme-corp',
  agentId: 'customer-service-agent',
  environment: 'production',
  compliance: ['SOC2', 'GDPR'],
});

// Wrap OpenAI client
const openai = new OpenAI();
const audited = createAuditedOpenAI(openai, { ledger });

// Start session
await ledger.start({ type: 'user', identifier: 'user_123' });

// All calls are automatically logged
const response = await audited.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Close and sign
const log = await ledger.close();
console.log(`Merkle root: ${log.merkle_root}`);
```

## Features

### Cryptographic Integrity
- **Hash Chains**: Every entry links to the previous via SHA-256
- **Merkle Trees**: Efficient range verification and tamper detection
- **Ed25519 Signatures**: Organization attestation on session close

### Structured Logging Schema
- Session metadata (org, agent, environment, compliance contexts)
- Model calls (provider, version, parameters, tokens, cost)
- Tool invocations (inputs, outputs, duration, resources accessed)
- Decision points (options considered, selection, reasoning)
- Human approvals (approver, role, attestation)
- State snapshots (checkpoints, metrics)

### Framework Integrations
- **OpenAI SDK**: Wrapper for chat completions with streaming support
- **Anthropic SDK**: Wrapper for messages API with tool use tracking
- **LangChain**: CallbackHandler for chains, agents, and retrievers
- **Generic**: `@audited` decorator for any async function

### Export Formats
- **JSONL**: Raw structured logs
- **Splunk CIM**: Common Information Model for Splunk
- **Elastic ECS**: Elastic Common Schema for Elasticsearch
- **FINRA 4511**: Financial services books and records format
- **EU AI Act**: Article 12 record-keeping schema

### Storage Backends
- **InMemory**: Development and testing
- **FileSystem**: Single-node production with write-ahead logging
- **S3-Compatible**: Distributed production with batched writes

### Error Handling
Custom error classes for precise error handling:
- `LedgerNotInitializedError`: Session not started
- `ValidationError`: Input validation failures
- `StorageError`: Storage backend issues
- `ChainVerificationError`: Hash chain integrity failures
- `SignatureVerificationError`: Signature verification failures

### Input Validation
Built-in validation helpers:
- `validateString`, `validateNumber`, `validateBoolean`
- `validateUUID`, `validateHash`, `validateTimestamp`
- `validateArray`, `validateObject`, `validateEnum`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Your AI Agent                          │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   OpenAI     │  │  Anthropic   │  │  LangChain   │      │
│  │   Wrapper    │  │   Wrapper    │  │  Callback    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                 │
│                    ┌──────▼───────┐                         │
│                    │    Ledger    │                         │
│                    │     API      │                         │
│                    └──────┬───────┘                         │
│                           │                                 │
│         ┌─────────────────┼─────────────────┐               │
│         │                 │                 │               │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────▼───────┐      │
│  │   Crypto     │  │   Schema     │  │   Storage    │      │
│  │  (chains,    │  │   (types,    │  │  (memory,    │      │
│  │   merkle,    │  │   errors,    │  │   file,      │      │
│  │   ed25519)   │  │   validation)│  │   s3)        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture documentation.

## Packages

| Package | Description |
|---------|-------------|
| `agentledger-core` | Types, crypto, storage, validation, errors, main API |
| `agentledger-openai` | OpenAI SDK integration |
| `agentledger-anthropic` | Anthropic SDK integration |
| `agentledger-langchain` | LangChain callback handler |
| `agentledger-cli` | Command-line verification and export |

## CLI Usage

```bash
# Verify chain integrity
npx agentledger-cli verify audit.jsonl

# Export to compliance format
npx agentledger-cli export audit.jsonl --format=finra_4511

# Replay session timeline
npx agentledger-cli replay audit.jsonl

# Show statistics and compliance score
npx agentledger-cli summary audit.jsonl
```

### Verification Output

```
AgentLedger Verification
──────────────────────────────────────────────────

ℹ Session: 550e8400-e29b-41d4-a716-446655440000
ℹ Organization: acme-financial
ℹ Agent: financial-advisor-v1
ℹ Entries: 47

Hash Chain Verification
✓ Chain integrity verified (47 entries)

Merkle Tree Verification
✓ Merkle root verified

Signature Verification
✓ Organization signature verified
  Signed at: 2024-12-25T10:30:00.000Z

──────────────────────────────────────────────────

✓ All verifications passed
```

## Compliance Examples

### FINRA 4511 (Financial Services)

```typescript
import { createLedger, hashContent } from 'agentledger-core';

const ledger = createLedger({
  orgId: 'broker-dealer-xyz',
  agentId: 'trading-advisor',
  compliance: ['FINRA_4511', 'FINRA_3110'],
  retentionDays: 2555, // 7 years
  signingKeys: loadFromHSM(), // Production: use HSM
});

// Log trading recommendation with human approval
await ledger.logDecision({
  decisionId: 'trade_rec_123',
  category: 'routing',
  optionsConsidered: [
    { option_id: 'buy_vti', description: 'Buy VTI', score: 0.8 },
    { option_id: 'hold', description: 'Hold position', score: 0.2 },
  ],
  selectedOption: 'buy_vti',
  reasoningHash: hashContent(reasoning),
  humanReviewRequired: true,
});

await ledger.logApproval({
  approverId: 'REP_67890',
  approverRole: 'Registered Representative',
  decisionRef: 'entry_uuid',
  approvalType: 'APPROVE',
});
```

### HIPAA (Healthcare)

```typescript
import { createLedger } from 'agentledger-core';

const ledger = createLedger({
  orgId: 'mercy-health',
  agentId: 'triage-assistant',
  compliance: ['HIPAA', 'SOC2'],
  retentionDays: 2190, // 6 years
});

// Log with PII flags (content stored as hash only)
await ledger.storeContent({
  contentType: 'completion',
  parentEntryId: entryId,
  content: clinicalNote,
  containsPii: true,
  piiTypes: ['medical', 'name'],
});
```

### EU AI Act Article 12

```typescript
import { createLedger } from 'agentledger-core';

const ledger = createLedger({
  orgId: 'eu-corp-gmbh',
  agentId: 'high-risk-classifier',
  compliance: ['EU_AI_ACT', 'GDPR'],
});

// Export for regulatory submission
const euFormat = await ledger.export({ format: 'eu_ai_act' });
```

## API Reference

### Ledger

```typescript
class Ledger {
  // Session management
  start(initiatedBy, metadata?): Promise<string>
  close(): Promise<AuditLog>

  // Logging
  logModelCall(params): Promise<ChainedEntry>
  logToolInvocation(params): Promise<ChainedEntry>
  logDecision(params): Promise<ChainedEntry>
  logApproval(params): Promise<ChainedEntry>
  snapshot(params): Promise<ChainedEntry>
  storeContent(params): Promise<ChainedEntry>

  // Verification
  verify(): Promise<{ valid: boolean; errors: string[] }>

  // Access
  getEntries(start?, end?): Promise<ChainedEntry[]>
  count(): Promise<number>
  getSession(): SessionEnvelope

  // Export
  export(options): Promise<Buffer>
}
```

### Entry Types

```typescript
type AuditEntry =
  | ModelCall        // LLM API calls
  | ToolInvocation   // Tool/function executions
  | DecisionPoint    // Agent routing decisions
  | HumanApproval    // Human-in-the-loop approvals
  | StateSnapshot    // Checkpoint captures
  | ContentReference // External content storage
```

### Error Handling

```typescript
import {
  LedgerNotInitializedError,
  ValidationError,
  isAgentLedgerError
} from 'agentledger-core';

try {
  await ledger.logModelCall({...});
} catch (error) {
  if (isAgentLedgerError(error)) {
    console.error(`AgentLedger error: ${error.code} - ${error.message}`);
  }
}
```

## Security Considerations

1. **Key Management**: Store signing keys in HSM/KMS for production
2. **PII Handling**: Use `containsPii` flag and hash-only storage for sensitive data
3. **Access Control**: Implement RBAC for audit log access
4. **Retention**: Configure `retentionDays` per compliance requirements
5. **Tamper Evidence**: Regularly verify chain integrity

## Performance

- **Append**: O(1) with async batching for S3
- **Verify**: O(n) full chain, O(log n) with Merkle proofs
- **Memory**: ~200 bytes per entry (hashes only)
- **Latency**: <1ms per log entry (in-memory), <5ms (filesystem)

## Roadmap

- [ ] Python SDK (`pip install agentledger`)
- [ ] AutoGen integration
- [ ] CrewAI integration
- [ ] Parquet export with DuckDB queries
- [ ] Real-time SIEM streaming (Kafka, Kinesis)
- [ ] Kubernetes operator for log aggregation
- [ ] Web dashboard for audit exploration

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Author

**Alex Galle-From**
- Website: [alexgallefrom.io](https://alexgallefrom.io)
- GitHub: [@substrateagnostic](https://github.com/substrateagnostic)

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Built for the accountability cliff.** When AI agent accountability becomes mandatory, you'll already be compliant.
