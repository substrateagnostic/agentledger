/**
 * AgentLedger Cryptographic Utilities
 * Hash chains, Merkle trees, and Ed25519 signatures for tamper-evident logging.
 *
 * Uses Node.js crypto module - no external dependencies.
 */

import { createHash, sign as cryptoSign, verify as cryptoVerify, generateKeyPairSync, randomUUID, createPrivateKey, createPublicKey } from 'crypto';
import type { ChainedEntry, AuditEntry, AuditLog } from './types';

// ============================================================================
// HASHING
// ============================================================================

/**
 * Compute SHA-256 hash of any data
 */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Hash an object deterministically (sorted keys recursively)
 */
export function hashObject(obj: unknown): string {
  const normalized = JSON.stringify(obj, sortedReplacer());
  return sha256(normalized);
}

/**
 * Creates a JSON replacer function that sorts object keys recursively
 */
function sortedReplacer() {
  return function(this: unknown, key: string, value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      const keys = Object.keys(value as object).sort();
      for (const k of keys) {
        sorted[k] = (value as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return value;
  };
}

/**
 * Hash content for storage reference
 */
export function hashContent(content: string | Buffer): string {
  return sha256(typeof content === 'string' ? Buffer.from(content, 'utf-8') : content);
}

// ============================================================================
// HASH CHAIN
// ============================================================================

/**
 * Create a chained entry from an audit entry
 */
export function createChainedEntry(
  entry: AuditEntry,
  sequence: number,
  previousHash: string
): ChainedEntry {
  const entryWithPrevious = {
    sequence,
    entry,
    previous_hash: previousHash,
  };

  const entryHash = hashObject(entryWithPrevious);

  return {
    ...entryWithPrevious,
    entry_hash: entryHash,
  };
}

/**
 * Verify a single link in the chain
 */
export function verifyChainLink(
  current: ChainedEntry,
  previous: ChainedEntry | null
): { valid: boolean; error?: string } {
  // Check sequence
  const expectedSequence = previous ? previous.sequence + 1 : 0;
  if (current.sequence !== expectedSequence) {
    return {
      valid: false,
      error: `Sequence mismatch: expected ${expectedSequence}, got ${current.sequence}`
    };
  }

  // Check previous hash
  const expectedPreviousHash = previous ? previous.entry_hash : '';
  if (current.previous_hash !== expectedPreviousHash) {
    return {
      valid: false,
      error: `Previous hash mismatch at sequence ${current.sequence}`
    };
  }

  // Verify entry hash
  const recomputed = hashObject({
    sequence: current.sequence,
    entry: current.entry,
    previous_hash: current.previous_hash,
  });

  if (current.entry_hash !== recomputed) {
    return {
      valid: false,
      error: `Entry hash mismatch at sequence ${current.sequence}`
    };
  }

  return { valid: true };
}

/**
 * Verify entire hash chain
 */
export function verifyChain(entries: ChainedEntry[]): {
  valid: boolean;
  errors: string[];
  verified_count: number;
} {
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const current = entries[i];
    const previous = i > 0 ? entries[i - 1] ?? null : null;
    if (!current) continue;
    const result = verifyChainLink(current, previous);

    if (!result.valid && result.error) {
      errors.push(result.error);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    verified_count: entries.length,
  };
}

// ============================================================================
// MERKLE TREE
// ============================================================================

/**
 * Build a Merkle tree from entry hashes
 * Returns the root hash and proof data
 */
export function buildMerkleTree(hashes: string[]): {
  root: string;
  tree: string[][];
} {
  if (hashes.length === 0) {
    return { root: '', tree: [] };
  }

  // Pad to power of 2
  const paddedHashes = [...hashes];
  while (paddedHashes.length & (paddedHashes.length - 1)) {
    const lastHash = paddedHashes[paddedHashes.length - 1];
    if (lastHash) paddedHashes.push(lastHash);
  }

  const tree: string[][] = [paddedHashes];

  let currentLevel = tree[tree.length - 1];
  while (currentLevel && currentLevel.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i] ?? '';
      const right = currentLevel[i + 1] ?? '';
      const combined = left + right;
      nextLevel.push(sha256(combined));
    }

    tree.push(nextLevel);
    currentLevel = tree[tree.length - 1];
  }

  const lastLevel = tree[tree.length - 1];
  const root = lastLevel?.[0] ?? '';

  return {
    root,
    tree,
  };
}

/**
 * Generate Merkle proof for a specific entry
 */
export function getMerkleProof(
  tree: string[][],
  index: number
): { hash: string; position: 'left' | 'right' }[] {
  const proof: { hash: string; position: 'left' | 'right' }[] = [];
  let currentIndex = index;

  for (let level = 0; level < tree.length - 1; level++) {
    const isLeft = currentIndex % 2 === 0;
    const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;
    const currentLevelArr = tree[level];

    if (currentLevelArr && siblingIndex < currentLevelArr.length) {
      const siblingHash = currentLevelArr[siblingIndex];
      if (siblingHash !== undefined) {
        proof.push({
          hash: siblingHash,
          position: isLeft ? 'right' : 'left',
        });
      }
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(
  leafHash: string,
  proof: { hash: string; position: 'left' | 'right' }[],
  root: string
): boolean {
  let currentHash = leafHash;

  for (const { hash, position } of proof) {
    if (position === 'left') {
      currentHash = sha256(hash + currentHash);
    } else {
      currentHash = sha256(currentHash + hash);
    }
  }

  return currentHash === root;
}

// ============================================================================
// ED25519 SIGNATURES
// ============================================================================

/**
 * Generate an Ed25519 key pair
 */
export function generateKeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return {
    publicKey: Buffer.from(publicKey).toString('base64'),
    privateKey: Buffer.from(privateKey).toString('base64'),
  };
}

/**
 * Sign data with Ed25519 private key
 */
export function sign(data: string, privateKeyBase64: string): string {
  const privateKeyPem = Buffer.from(privateKeyBase64, 'base64').toString('utf-8');
  const privateKeyObj = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, Buffer.from(data), privateKeyObj);
  return signature.toString('base64');
}

/**
 * Verify Ed25519 signature
 */
export function verify(data: string, signature: string, publicKeyBase64: string): boolean {
  try {
    const publicKeyPem = Buffer.from(publicKeyBase64, 'base64').toString('utf-8');
    const publicKeyObj = createPublicKey(publicKeyPem);
    return cryptoVerify(null, Buffer.from(data), publicKeyObj, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Sign an audit log (typically on session close)
 */
export function signAuditLog(
  log: AuditLog,
  privateKeyBase64: string,
  publicKeyBase64: string
): AuditLog['org_signature'] {
  const dataToSign = JSON.stringify({
    session_id: log.session.session_id,
    merkle_root: log.merkle_root,
    entry_count: log.entries.length,
    closed_at: log.session.closed_at,
  });

  return {
    public_key: publicKeyBase64,
    signature: sign(dataToSign, privateKeyBase64),
    signed_at: new Date().toISOString(),
  };
}

/**
 * Verify audit log signature
 */
export function verifyAuditLogSignature(log: AuditLog): boolean {
  if (!log.org_signature) return false;

  const dataToSign = JSON.stringify({
    session_id: log.session.session_id,
    merkle_root: log.merkle_root,
    entry_count: log.entries.length,
    closed_at: log.session.closed_at,
  });

  return verify(dataToSign, log.org_signature.signature, log.org_signature.public_key);
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Generate a cryptographically random UUID
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Create a timestamp in ISO 8601 format
 */
export function timestamp(): string {
  return new Date().toISOString();
}
