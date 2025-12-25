/**
 * Custom error classes for AgentLedger
 *
 * Provides typed errors for better error handling and debugging.
 */

/**
 * Base error class for all AgentLedger errors
 */
export class AgentLedgerError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AgentLedgerError';
    this.code = code;
    this.details = details;

    // Maintain proper stack trace for where error was thrown (only in V8 environments)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * Thrown when ledger methods are called before initialization
 */
export class LedgerNotInitializedError extends AgentLedgerError {
  constructor(methodName?: string) {
    super(
      methodName
        ? `Ledger not initialized. Call start() before calling ${methodName}().`
        : 'Ledger not initialized. Call start() first.',
      'LEDGER_NOT_INITIALIZED',
      { methodName }
    );
    this.name = 'LedgerNotInitializedError';
  }
}

/**
 * Thrown when input validation fails
 */
export class ValidationError extends AgentLedgerError {
  readonly field?: string;
  readonly expectedType?: string;
  readonly receivedValue?: unknown;

  constructor(
    message: string,
    details?: {
      field?: string;
      expectedType?: string;
      receivedValue?: unknown;
    }
  ) {
    super(message, 'VALIDATION_ERROR', details as Record<string, unknown>);
    this.name = 'ValidationError';
    this.field = details?.field;
    this.expectedType = details?.expectedType;
    this.receivedValue = details?.receivedValue;
  }
}

/**
 * Thrown when storage operations fail
 */
export class StorageError extends AgentLedgerError {
  readonly operation: string;

  constructor(
    message: string,
    operation: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'STORAGE_ERROR', { operation, ...details });
    this.name = 'StorageError';
    this.operation = operation;
  }
}

/**
 * Thrown when cryptographic operations fail
 */
export class CryptoError extends AgentLedgerError {
  readonly operation: string;

  constructor(
    message: string,
    operation: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'CRYPTO_ERROR', { operation, ...details });
    this.name = 'CryptoError';
    this.operation = operation;
  }
}

/**
 * Thrown when hash chain verification fails
 */
export class ChainVerificationError extends AgentLedgerError {
  readonly entryIndex?: number;
  readonly expectedHash?: string;
  readonly actualHash?: string;

  constructor(
    message: string,
    details?: {
      entryIndex?: number;
      expectedHash?: string;
      actualHash?: string;
    }
  ) {
    super(message, 'CHAIN_VERIFICATION_ERROR', details as Record<string, unknown>);
    this.name = 'ChainVerificationError';
    this.entryIndex = details?.entryIndex;
    this.expectedHash = details?.expectedHash;
    this.actualHash = details?.actualHash;
  }
}

/**
 * Thrown when signature verification fails
 */
export class SignatureVerificationError extends AgentLedgerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'SIGNATURE_VERIFICATION_ERROR', details);
    this.name = 'SignatureVerificationError';
  }
}

/**
 * Thrown when export operations fail
 */
export class ExportError extends AgentLedgerError {
  readonly format?: string;

  constructor(
    message: string,
    format?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'EXPORT_ERROR', { format, ...details });
    this.name = 'ExportError';
    this.format = format;
  }
}

/**
 * Thrown when session operations fail
 */
export class SessionError extends AgentLedgerError {
  readonly sessionId?: string;

  constructor(
    message: string,
    sessionId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'SESSION_ERROR', { sessionId, ...details });
    this.name = 'SessionError';
    this.sessionId = sessionId;
  }
}

/**
 * Type guard to check if an error is an AgentLedgerError
 */
export function isAgentLedgerError(error: unknown): error is AgentLedgerError {
  return error instanceof AgentLedgerError;
}

/**
 * Type guard to check specific error types
 */
export function isErrorCode<T extends AgentLedgerError>(
  error: unknown,
  code: string
): error is T {
  return isAgentLedgerError(error) && error.code === code;
}
