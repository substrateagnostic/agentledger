# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-12-25

### Added

- **Core Package (`@agentledger/core`)**
  - `Ledger` class for managing audit sessions
  - Hash chain creation and verification for tamper-evident logging
  - Merkle tree construction and proof generation
  - Ed25519 digital signatures for cryptographic attestation
  - Multiple storage backends: InMemoryStorage, FileSystemStorage, S3Storage
  - Entry types: ModelCall, ToolInvocation, DecisionPoint, HumanApproval, StateSnapshot, ContentReference
  - Export formats: JSONL, Splunk CIM, Elastic ECS, FINRA 4511, EU AI Act
  - Zod schema validation for all entry types

- **OpenAI Package (`@agentledger/openai`)**
  - `AuditedOpenAI` wrapper class for automatic audit logging
  - Support for both streaming and non-streaming completions
  - Automatic token counting and cost estimation
  - Content storage option for full prompt/completion capture
  - `audited` decorator for function-level auditing
  - Convenience functions: `createAuditedOpenAI`, `auditedChatCompletion`

- **CLI Package (`@agentledger/cli`)**
  - `verify` command for validating audit log integrity
  - `export` command for converting to compliance formats
  - `replay` command for viewing session timelines
  - `summary` command for statistics and compliance scoring
  - Colorful terminal output with progress indicators

- **Testing**
  - Comprehensive Jest test suite with 162+ tests
  - 90%+ coverage on core cryptographic functions
  - Integration tests for CLI commands
  - Mock OpenAI client for testing without API keys

- **Examples**
  - Interactive demo showing 3-turn conversation
  - Mock OpenAI fallback when no API key present
  - Automatic export to multiple compliance formats

- **CI/CD**
  - GitHub Actions workflow for Node 18, 20, 22
  - TypeScript type checking
  - Security audit
  - Demo verification

### Security

- Zero external cryptographic dependencies (uses Node.js `crypto` module only)
- Ed25519 signatures for tamper-proof attestation
- SHA-256 hashing for content integrity
- Hash chain verification for sequential integrity

### Compliance

- FINRA 4511 Books and Records format
- EU AI Act Article 12 logging requirements
- 7-year default retention period
- Human review workflow support
- Decision point documentation

## [Unreleased]

### Planned
- Anthropic SDK integration
- LangChain callback handler
- Real-time S3 streaming
- Web dashboard for log visualization
- Webhook notifications for compliance events
