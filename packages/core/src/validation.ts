/**
 * Input validation helpers for AgentLedger
 *
 * Provides type-safe validation functions for common input types.
 */

import { ValidationError } from './errors';

/**
 * Validates that a value is a non-empty string
 */
export function validateString(
  value: unknown,
  fieldName: string,
  options: { minLength?: number; maxLength?: number; pattern?: RegExp } = {}
): string {
  if (typeof value !== 'string') {
    throw new ValidationError(
      `${fieldName} must be a string`,
      { field: fieldName, expectedType: 'string', receivedValue: value }
    );
  }

  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new ValidationError(
      `${fieldName} must be at least ${options.minLength} characters`,
      { field: fieldName, receivedValue: value }
    );
  }

  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new ValidationError(
      `${fieldName} must be at most ${options.maxLength} characters`,
      { field: fieldName, receivedValue: value }
    );
  }

  if (options.pattern && !options.pattern.test(value)) {
    throw new ValidationError(
      `${fieldName} does not match required pattern`,
      { field: fieldName, receivedValue: value }
    );
  }

  return value;
}

/**
 * Validates that a value is a non-empty string (alias with minLength: 1)
 */
export function validateNonEmptyString(value: unknown, fieldName: string): string {
  return validateString(value, fieldName, { minLength: 1 });
}

/**
 * Validates that a value is a number within optional bounds
 */
export function validateNumber(
  value: unknown,
  fieldName: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new ValidationError(
      `${fieldName} must be a number`,
      { field: fieldName, expectedType: 'number', receivedValue: value }
    );
  }

  if (options.integer && !Number.isInteger(value)) {
    throw new ValidationError(
      `${fieldName} must be an integer`,
      { field: fieldName, receivedValue: value }
    );
  }

  if (options.min !== undefined && value < options.min) {
    throw new ValidationError(
      `${fieldName} must be at least ${options.min}`,
      { field: fieldName, receivedValue: value }
    );
  }

  if (options.max !== undefined && value > options.max) {
    throw new ValidationError(
      `${fieldName} must be at most ${options.max}`,
      { field: fieldName, receivedValue: value }
    );
  }

  return value;
}

/**
 * Validates that a value is a positive integer
 */
export function validatePositiveInteger(value: unknown, fieldName: string): number {
  return validateNumber(value, fieldName, { min: 1, integer: true });
}

/**
 * Validates that a value is a non-negative integer
 */
export function validateNonNegativeInteger(value: unknown, fieldName: string): number {
  return validateNumber(value, fieldName, { min: 0, integer: true });
}

/**
 * Validates that a value is a boolean
 */
export function validateBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ValidationError(
      `${fieldName} must be a boolean`,
      { field: fieldName, expectedType: 'boolean', receivedValue: value }
    );
  }
  return value;
}

/**
 * Validates that a value is an array
 */
export function validateArray<T>(
  value: unknown,
  fieldName: string,
  options: { minLength?: number; maxLength?: number; itemValidator?: (item: unknown, index: number) => T } = {}
): T[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(
      `${fieldName} must be an array`,
      { field: fieldName, expectedType: 'array', receivedValue: value }
    );
  }

  if (options.minLength !== undefined && value.length < options.minLength) {
    throw new ValidationError(
      `${fieldName} must have at least ${options.minLength} items`,
      { field: fieldName, receivedValue: value }
    );
  }

  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new ValidationError(
      `${fieldName} must have at most ${options.maxLength} items`,
      { field: fieldName, receivedValue: value }
    );
  }

  if (options.itemValidator) {
    return value.map((item, index) => options.itemValidator!(item, index));
  }

  return value as T[];
}

/**
 * Validates that a value is a non-empty array
 */
export function validateNonEmptyArray<T>(
  value: unknown,
  fieldName: string,
  itemValidator?: (item: unknown, index: number) => T
): T[] {
  return validateArray(value, fieldName, { minLength: 1, itemValidator });
}

/**
 * Validates that a value is an object (not null, not array)
 */
export function validateObject<T extends Record<string, unknown>>(
  value: unknown,
  fieldName: string
): T {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      `${fieldName} must be an object`,
      { field: fieldName, expectedType: 'object', receivedValue: value }
    );
  }
  return value as T;
}

/**
 * Validates that a value is one of allowed values
 */
export function validateEnum<T extends string | number>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[]
): T {
  if (!allowedValues.includes(value as T)) {
    throw new ValidationError(
      `${fieldName} must be one of: ${allowedValues.join(', ')}`,
      { field: fieldName, receivedValue: value }
    );
  }
  return value as T;
}

/**
 * Validates a UUID format
 */
export function validateUUID(value: unknown, fieldName: string): string {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return validateString(value, fieldName, { pattern: uuidPattern });
}

/**
 * Validates an ISO 8601 timestamp
 */
export function validateTimestamp(value: unknown, fieldName: string): string {
  const str = validateString(value, fieldName);
  const date = new Date(str);
  if (isNaN(date.getTime())) {
    throw new ValidationError(
      `${fieldName} must be a valid ISO 8601 timestamp`,
      { field: fieldName, receivedValue: value }
    );
  }
  return str;
}

/**
 * Validates a SHA-256 hash (64 hex characters)
 */
export function validateHash(value: unknown, fieldName: string): string {
  return validateString(value, fieldName, {
    minLength: 64,
    maxLength: 64,
    pattern: /^[a-f0-9]{64}$/i,
  });
}

/**
 * Validates an optional value - returns undefined if null/undefined, otherwise validates
 */
export function validateOptional<T>(
  value: unknown,
  fieldName: string,
  validator: (value: unknown, fieldName: string) => T
): T | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return validator(value, fieldName);
}

/**
 * Validates that at least one of the specified fields is present
 */
export function validateAtLeastOne<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[],
  objectName: string
): void {
  const hasAny = fields.some(field => obj[field] !== undefined && obj[field] !== null);
  if (!hasAny) {
    throw new ValidationError(
      `${objectName} must have at least one of: ${fields.join(', ')}`,
      { field: objectName, receivedValue: obj }
    );
  }
}

/**
 * Creates a validator that checks if a value matches a type guard
 */
export function createTypeValidator<T>(
  typeGuard: (value: unknown) => value is T,
  typeName: string
): (value: unknown, fieldName: string) => T {
  return (value: unknown, fieldName: string): T => {
    if (!typeGuard(value)) {
      throw new ValidationError(
        `${fieldName} must be a valid ${typeName}`,
        { field: fieldName, expectedType: typeName, receivedValue: value }
      );
    }
    return value;
  };
}
