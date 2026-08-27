/**
 * Session persistence + TTL tests (Phase 8 repair) against a real MongoDB.
 *
 * Proves the sessions collection has a TTL index (expireAfterSeconds: 0) on the
 * BSON-Date `expiresAt`, that a live session round-trips as an ISO string, and
 * that an already-expired session is rejected IMMEDIATELY on read (before the
 * background TTL monitor runs).
 */
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoDocumentRepository } from './mongoDocumentRepository.js';

let replSet: MongoMemoryReplSet | undefined;
let repository: MongoDocumentRepository;
let raw: MongoClient;
let uri: string;
const dbName = 'vsdd_sessions_test';

beforeAll(async () => {
  if (process.env.MONGO_TEST_URI) {
    uri = process.env.MONGO_TEST_URI;
  } else {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
  }
  repository = await MongoDocumentRepository.connect({ uri, dbName });
  raw = new MongoClient(uri);
  await raw.connect();
}, 120_000);

afterAll(async () => {
  await raw?.close();
  await repository?.close();
  await replSet?.stop();
});

describe('session persistence + TTL', () => {
  it('creates a TTL index (expireAfterSeconds: 0) on expiresAt', async () => {
    const indexes = await raw.db(dbName).collection('sessions').indexes();
    const ttl = indexes.find(
      (i) => i.key?.expiresAt === 1 && i.expireAfterSeconds === 0,
    );
    expect(ttl).toBeDefined();
  });

  it('round-trips a live session as an ISO string', async () => {
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();
    await repository.createSession({
      id: 'sess-live',
      userId: 'user-1',
      createdAt: new Date().toISOString(),
      expiresAt,
    });
    const found = await repository.getSession('sess-live');
    expect(found).not.toBeNull();
    expect(found?.expiresAt).toBe(expiresAt);
    // Persisted as a BSON Date so the TTL monitor can reap it.
    const rawDoc = await raw.db(dbName).collection('sessions').findOne({ id: 'sess-live' });
    expect(rawDoc?.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects an already-expired session immediately on read', async () => {
    await repository.createSession({
      id: 'sess-expired',
      userId: 'user-1',
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await repository.getSession('sess-expired')).toBeNull();
  });
});
