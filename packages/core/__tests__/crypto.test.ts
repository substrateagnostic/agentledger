/**
 * Comprehensive tests for AgentLedger cryptographic utilities
 */

import {
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
} from '../src/crypto';

import type { ModelCall, AuditLog, ChainedEntry, SessionEnvelope } from '../src/types';

// Helper to create a valid model call entry
function createModelCallEntry(overrides: Partial<ModelCall> = {}): ModelCall {
  return {
    type: 'model_call',
    entry_id: generateId(),
    timestamp: timestamp(),
    provider: 'openai',
    model_id: 'gpt-4',
    parameters: { temperature: 0.7 },
    prompt_hash: hashContent('test prompt'),
    prompt_tokens: 100,
    completion_hash: hashContent('test response'),
    completion_tokens: 50,
    latency_ms: 500,
    streamed: false,
    ...overrides,
  };
}

// Helper to create a valid session envelope
function createSessionEnvelope(overrides: Partial<SessionEnvelope> = {}): SessionEnvelope {
  return {
    session_id: generateId(),
    org_id: 'test-org',
    agent_id: 'test-agent',
    agent_version: '1.0.0',
    environment: 'test',
    initiated_by: {
      type: 'user',
      identifier: 'test-user',
    },
    initiated_at: timestamp(),
    compliance_contexts: ['FINRA_4511'],
    retention_days: 2555,
    ...overrides,
  };
}

describe('SHA-256 Hashing', () => {
  test('produces 64-character hex string', () => {
    const hash = sha256('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  test('is deterministic', () => {
    const input = 'test data';
    expect(sha256(input)).toBe(sha256(input));
  });

  test('differs for different inputs', () => {
    expect(sha256('data1')).not.toBe(sha256('data2'));
  });

  test('handles empty string', () => {
    const hash = sha256('');
    expect(hash).toHaveLength(64);
  });

  test('handles Buffer input', () => {
    const hash = sha256(Buffer.from('hello'));
    expect(hash).toHaveLength(64);
  });

  test('handles unicode characters', () => {
    const hash = sha256('こんにちは世界');
    expect(hash).toHaveLength(64);
  });

  test('handles large input', () => {
    const largeInput = 'x'.repeat(1000000);
    const hash = sha256(largeInput);
    expect(hash).toHaveLength(64);
  });
});

describe('hashObject', () => {
  test('produces deterministic hash regardless of key order', () => {
    const obj1 = { b: 2, a: 1, c: 3 };
    const obj2 = { a: 1, b: 2, c: 3 };
    const obj3 = { c: 3, a: 1, b: 2 };

    expect(hashObject(obj1)).toBe(hashObject(obj2));
    expect(hashObject(obj2)).toBe(hashObject(obj3));
  });

  test('handles nested objects with consistent ordering', () => {
    const obj1 = { outer: { b: 2, a: 1 }, x: 10 };
    const obj2 = { x: 10, outer: { a: 1, b: 2 } };

    expect(hashObject(obj1)).toBe(hashObject(obj2));
  });

  test('produces different hashes for different values', () => {
    const obj1 = { a: 1 };
    const obj2 = { a: 2 };

    expect(hashObject(obj1)).not.toBe(hashObject(obj2));
  });

  test('handles arrays', () => {
    const obj1 = { arr: [1, 2, 3] };
    const obj2 = { arr: [1, 2, 3] };
    const obj3 = { arr: [3, 2, 1] };

    expect(hashObject(obj1)).toBe(hashObject(obj2));
    expect(hashObject(obj1)).not.toBe(hashObject(obj3));
  });

  test('handles empty objects', () => {
    const hash = hashObject({});
    expect(hash).toHaveLength(64);
  });
});

describe('hashContent', () => {
  test('hashes string content', () => {
    const hash = hashContent('test content');
    expect(hash).toHaveLength(64);
  });

  test('hashes Buffer content', () => {
    const hash = hashContent(Buffer.from('test content'));
    expect(hash).toHaveLength(64);
  });

  test('produces same hash for same content', () => {
    expect(hashContent('same')).toBe(hashContent('same'));
  });
});

describe('Hash Chain', () => {
  describe('createChainedEntry', () => {
    test('creates valid first entry with empty previous hash', () => {
      const entry = createModelCallEntry();
      const chained = createChainedEntry(entry, 0, '');

      expect(chained.sequence).toBe(0);
      expect(chained.entry).toEqual(entry);
      expect(chained.previous_hash).toBe('');
      expect(chained.entry_hash).toHaveLength(64);
    });

    test('creates valid subsequent entry with previous hash', () => {
      const entry1 = createModelCallEntry();
      const chained1 = createChainedEntry(entry1, 0, '');

      const entry2 = createModelCallEntry();
      const chained2 = createChainedEntry(entry2, 1, chained1.entry_hash);

      expect(chained2.sequence).toBe(1);
      expect(chained2.previous_hash).toBe(chained1.entry_hash);
      expect(chained2.entry_hash).toHaveLength(64);
      expect(chained2.entry_hash).not.toBe(chained1.entry_hash);
    });

    test('produces deterministic hash for same entry', () => {
      const entry = createModelCallEntry({ entry_id: 'fixed-id' });
      const chained1 = createChainedEntry(entry, 0, '');
      const chained2 = createChainedEntry(entry, 0, '');

      expect(chained1.entry_hash).toBe(chained2.entry_hash);
    });
  });

  describe('verifyChainLink', () => {
    test('validates first entry correctly', () => {
      const entry = createModelCallEntry();
      const chained = createChainedEntry(entry, 0, '');
      const result = verifyChainLink(chained, null);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('validates subsequent entry correctly', () => {
      const entry1 = createModelCallEntry();
      const chained1 = createChainedEntry(entry1, 0, '');

      const entry2 = createModelCallEntry();
      const chained2 = createChainedEntry(entry2, 1, chained1.entry_hash);

      const result = verifyChainLink(chained2, chained1);
      expect(result.valid).toBe(true);
    });

    test('detects sequence mismatch', () => {
      const entry1 = createModelCallEntry();
      const chained1 = createChainedEntry(entry1, 0, '');

      const entry2 = createModelCallEntry();
      const chained2 = createChainedEntry(entry2, 5, chained1.entry_hash); // Wrong sequence

      const result = verifyChainLink(chained2, chained1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Sequence mismatch');
    });

    test('detects previous hash mismatch', () => {
      const entry1 = createModelCallEntry();
      const chained1 = createChainedEntry(entry1, 0, '');

      const entry2 = createModelCallEntry();
      const chained2 = createChainedEntry(entry2, 1, 'wrong-previous-hash');

      const result = verifyChainLink(chained2, chained1);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Previous hash mismatch');
    });

    test('detects entry hash tampering', () => {
      const entry = createModelCallEntry();
      const chained = createChainedEntry(entry, 0, '');

      // Tamper with the entry
      (chained.entry as ModelCall).prompt_tokens = 999;

      const result = verifyChainLink(chained, null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Entry hash mismatch');
    });
  });

  describe('verifyChain', () => {
    test('validates empty chain', () => {
      const result = verifyChain([]);
      expect(result.valid).toBe(true);
      expect(result.verified_count).toBe(0);
    });

    test('validates single entry chain', () => {
      const entry = createModelCallEntry();
      const chained = createChainedEntry(entry, 0, '');

      const result = verifyChain([chained]);
      expect(result.valid).toBe(true);
      expect(result.verified_count).toBe(1);
    });

    test('validates 10+ entry chain', () => {
      const entries: ChainedEntry[] = [];
      let previousHash = '';

      for (let i = 0; i < 15; i++) {
        const entry = createModelCallEntry({ prompt_tokens: i * 10 });
        const chained = createChainedEntry(entry, i, previousHash);
        entries.push(chained);
        previousHash = chained.entry_hash;
      }

      const result = verifyChain(entries);
      expect(result.valid).toBe(true);
      expect(result.verified_count).toBe(15);
      expect(result.errors).toHaveLength(0);
    });

    test('detects tampering in middle of chain', () => {
      const entries: ChainedEntry[] = [];
      let previousHash = '';

      for (let i = 0; i < 5; i++) {
        const entry = createModelCallEntry({ prompt_tokens: i * 10 });
        const chained = createChainedEntry(entry, i, previousHash);
        entries.push(chained);
        previousHash = chained.entry_hash;
      }

      // Tamper with entry 2
      (entries[2]!.entry as ModelCall).prompt_tokens = 9999;

      const result = verifyChain(entries);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('detects broken chain link', () => {
      const entry1 = createModelCallEntry();
      const chained1 = createChainedEntry(entry1, 0, '');

      const entry2 = createModelCallEntry();
      const chained2 = createChainedEntry(entry2, 1, 'broken-link');

      const result = verifyChain([chained1, chained2]);
      expect(result.valid).toBe(false);
    });
  });
});

describe('Merkle Tree', () => {
  describe('buildMerkleTree', () => {
    test('handles empty input', () => {
      const { root, tree } = buildMerkleTree([]);
      expect(root).toBe('');
      expect(tree).toHaveLength(0);
    });

    test('handles single hash', () => {
      const hashes = [sha256('a')];
      const { root, tree } = buildMerkleTree(hashes);

      expect(root).toBe(hashes[0]);
      expect(tree.length).toBeGreaterThan(0);
    });

    test('handles power of 2 hashes', () => {
      const hashes = ['a', 'b', 'c', 'd'].map(sha256);
      const { root, tree } = buildMerkleTree(hashes);

      expect(root).toHaveLength(64);
      expect(tree.length).toBe(3); // 4 leaves + 2 nodes + 1 root
    });

    test('handles non-power of 2 hashes (pads correctly)', () => {
      const hashes = ['a', 'b', 'c'].map(sha256);
      const { root, tree } = buildMerkleTree(hashes);

      expect(root).toHaveLength(64);
      expect(tree.length).toBeGreaterThan(0);
    });

    test('handles 8 hashes', () => {
      const hashes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(sha256);
      const { root, tree } = buildMerkleTree(hashes);

      expect(root).toHaveLength(64);
      expect(tree.length).toBe(4); // 8 + 4 + 2 + 1 levels
    });

    test('is deterministic', () => {
      const hashes = ['a', 'b', 'c', 'd'].map(sha256);
      const result1 = buildMerkleTree(hashes);
      const result2 = buildMerkleTree(hashes);

      expect(result1.root).toBe(result2.root);
    });

    test('different inputs produce different roots', () => {
      const hashes1 = ['a', 'b', 'c', 'd'].map(sha256);
      const hashes2 = ['a', 'b', 'c', 'e'].map(sha256);

      const result1 = buildMerkleTree(hashes1);
      const result2 = buildMerkleTree(hashes2);

      expect(result1.root).not.toBe(result2.root);
    });
  });

  describe('getMerkleProof and verifyMerkleProof', () => {
    test('generates and verifies proof for each leaf (4 elements)', () => {
      const hashes = ['a', 'b', 'c', 'd'].map(sha256);
      const { root, tree } = buildMerkleTree(hashes);

      for (let i = 0; i < hashes.length; i++) {
        const proof = getMerkleProof(tree, i);
        const valid = verifyMerkleProof(hashes[i]!, proof, root);
        expect(valid).toBe(true);
      }
    });

    test('generates and verifies proof for each leaf (8 elements)', () => {
      const hashes = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(sha256);
      const { root, tree } = buildMerkleTree(hashes);

      for (let i = 0; i < hashes.length; i++) {
        const proof = getMerkleProof(tree, i);
        const valid = verifyMerkleProof(hashes[i]!, proof, root);
        expect(valid).toBe(true);
      }
    });

    test('rejects proof with wrong leaf hash', () => {
      const hashes = ['a', 'b', 'c', 'd'].map(sha256);
      const { root, tree } = buildMerkleTree(hashes);

      const proof = getMerkleProof(tree, 0);
      const wrongHash = sha256('wrong');
      const valid = verifyMerkleProof(wrongHash, proof, root);

      expect(valid).toBe(false);
    });

    test('rejects proof with wrong root', () => {
      const hashes = ['a', 'b', 'c', 'd'].map(sha256);
      const { tree } = buildMerkleTree(hashes);

      const proof = getMerkleProof(tree, 0);
      const wrongRoot = sha256('wrong root');
      const valid = verifyMerkleProof(hashes[0]!, proof, wrongRoot);

      expect(valid).toBe(false);
    });

    test('handles single element tree', () => {
      const hashes = [sha256('only')];
      const { root, tree } = buildMerkleTree(hashes);

      const proof = getMerkleProof(tree, 0);
      const valid = verifyMerkleProof(hashes[0]!, proof, root);

      expect(valid).toBe(true);
    });
  });

  test('detects duplicate hashes correctly', () => {
    const hash = sha256('duplicate');
    const hashes = [hash, hash, hash, hash];
    const { root, tree } = buildMerkleTree(hashes);

    // All proofs should still work
    for (let i = 0; i < hashes.length; i++) {
      const proof = getMerkleProof(tree, i);
      const valid = verifyMerkleProof(hash, proof, root);
      expect(valid).toBe(true);
    }
  });
});

describe('Ed25519 Signatures', () => {
  describe('generateKeyPair', () => {
    test('generates valid key pair', () => {
      const { publicKey, privateKey } = generateKeyPair();

      expect(publicKey).toBeTruthy();
      expect(privateKey).toBeTruthy();
      expect(publicKey.length).toBeGreaterThan(50);
      expect(privateKey.length).toBeGreaterThan(100);
    });

    test('generates unique key pairs', () => {
      const pair1 = generateKeyPair();
      const pair2 = generateKeyPair();

      expect(pair1.publicKey).not.toBe(pair2.publicKey);
      expect(pair1.privateKey).not.toBe(pair2.privateKey);
    });
  });

  describe('sign and verify', () => {
    test('signs and verifies data correctly', () => {
      const { publicKey, privateKey } = generateKeyPair();
      const data = 'test message to sign';

      const signature = sign(data, privateKey);
      const isValid = verify(data, signature, publicKey);

      expect(signature).toBeTruthy();
      expect(isValid).toBe(true);
    });

    test('produces consistent signature for same data and key', () => {
      const { privateKey } = generateKeyPair();
      const data = 'consistent data';

      // Ed25519 signatures should be deterministic
      const sig1 = sign(data, privateKey);
      const sig2 = sign(data, privateKey);

      expect(sig1).toBe(sig2);
    });

    test('produces different signatures for different data', () => {
      const { privateKey } = generateKeyPair();

      const sig1 = sign('data1', privateKey);
      const sig2 = sign('data2', privateKey);

      expect(sig1).not.toBe(sig2);
    });

    test('rejects tampered data', () => {
      const { publicKey, privateKey } = generateKeyPair();
      const data = 'original message';

      const signature = sign(data, privateKey);
      const isValid = verify('tampered message', signature, publicKey);

      expect(isValid).toBe(false);
    });

    test('rejects wrong public key', () => {
      const keys1 = generateKeyPair();
      const keys2 = generateKeyPair();
      const data = 'test message';

      const signature = sign(data, keys1.privateKey);
      const isValid = verify(data, signature, keys2.publicKey);

      expect(isValid).toBe(false);
    });

    test('handles empty data', () => {
      const { publicKey, privateKey } = generateKeyPair();
      const signature = sign('', privateKey);
      const isValid = verify('', signature, publicKey);

      expect(isValid).toBe(true);
    });

    test('handles unicode data', () => {
      const { publicKey, privateKey } = generateKeyPair();
      const data = '你好世界 🌍 مرحبا';

      const signature = sign(data, privateKey);
      const isValid = verify(data, signature, publicKey);

      expect(isValid).toBe(true);
    });
  });

  describe('signAuditLog and verifyAuditLogSignature', () => {
    test('signs and verifies audit log', () => {
      const { publicKey, privateKey } = generateKeyPair();

      const entry = createModelCallEntry();
      const chained = createChainedEntry(entry, 0, '');
      const { root } = buildMerkleTree([chained.entry_hash]);

      const log: AuditLog = {
        version: '1.0.0',
        session: createSessionEnvelope({ closed_at: timestamp() }),
        entries: [chained],
        merkle_root: root,
      };

      log.org_signature = signAuditLog(log, privateKey, publicKey);

      expect(log.org_signature).toBeTruthy();
      expect(log.org_signature!.public_key).toBe(publicKey);
      expect(log.org_signature!.signature).toBeTruthy();
      expect(log.org_signature!.signed_at).toBeTruthy();

      const isValid = verifyAuditLogSignature(log);
      expect(isValid).toBe(true);
    });

    test('rejects unsigned log', () => {
      const entry = createModelCallEntry();
      const chained = createChainedEntry(entry, 0, '');

      const log: AuditLog = {
        version: '1.0.0',
        session: createSessionEnvelope(),
        entries: [chained],
        merkle_root: '',
      };

      const isValid = verifyAuditLogSignature(log);
      expect(isValid).toBe(false);
    });

    test('rejects tampered log', () => {
      const { publicKey, privateKey } = generateKeyPair();

      const entry = createModelCallEntry();
      const chained = createChainedEntry(entry, 0, '');
      const { root } = buildMerkleTree([chained.entry_hash]);

      const log: AuditLog = {
        version: '1.0.0',
        session: createSessionEnvelope({ closed_at: timestamp() }),
        entries: [chained],
        merkle_root: root,
      };

      log.org_signature = signAuditLog(log, privateKey, publicKey);

      // Tamper with the log
      log.merkle_root = 'tampered';

      const isValid = verifyAuditLogSignature(log);
      expect(isValid).toBe(false);
    });
  });
});

describe('Utilities', () => {
  describe('generateId', () => {
    test('produces valid UUID format', () => {
      const id = generateId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect(id).toMatch(uuidRegex);
    });

    test('produces unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(1000);
    });
  });

  describe('timestamp', () => {
    test('produces ISO 8601 format', () => {
      const ts = timestamp();
      const date = new Date(ts);

      expect(date.toISOString()).toBe(ts);
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    });

    test('produces UTC time', () => {
      const ts = timestamp();
      expect(ts.endsWith('Z')).toBe(true);
    });

    test('produces current time', () => {
      const before = Date.now();
      const ts = timestamp();
      const after = Date.now();

      const tsTime = new Date(ts).getTime();
      expect(tsTime).toBeGreaterThanOrEqual(before);
      expect(tsTime).toBeLessThanOrEqual(after);
    });
  });
});
