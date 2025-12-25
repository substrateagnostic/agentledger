/**
 * @agentledger/core
 * AI Agent Audit Trail SDK
 *
 * Structured, compliance-ready logging for AI agents in regulated industries.
 * Supports FINRA 4511/3110, EU AI Act, HIPAA, SOC2.
 */

// Types
export * from './types';

// Errors
export {
  AgentLedgerError,
  LedgerNotInitializedError,
  ValidationError,
  StorageError,
  CryptoError,
  ChainVerificationError,
  SignatureVerificationError,
  ExportError,
  SessionError,
  isAgentLedgerError,
  isErrorCode,
} from './errors';

// Validation
export {
  validateString,
  validateNonEmptyString,
  validateNumber,
  validatePositiveInteger,
  validateNonNegativeInteger,
  validateBoolean,
  validateArray,
  validateNonEmptyArray,
  validateObject,
  validateEnum,
  validateUUID,
  validateTimestamp,
  validateHash,
  validateOptional,
  validateAtLeastOne,
  createTypeValidator,
} from './validation';

// Cryptography
export {
  sha256,
  hashObject,
  hashContent,
  createChainedEntry,
  verifyChainLink,
  verifyChain,
  buildMerkleTree,
  getMerkleProof,
  verifyMerkleProof,
  generateKeyPair,
  sign,
  verify,
  signAuditLog,
  verifyAuditLogSignature,
  generateId,
  timestamp,
} from './crypto';

// Storage
export {
  InMemoryStorage,
  FileSystemStorage,
  S3Storage,
} from './storage';
export type { StorageBackend, S3Config } from './storage';

// Main API
export {
  Ledger,
  createLedger,
  generateSigningKeys,
} from './ledger';
export type { LedgerConfig } from './ledger';
