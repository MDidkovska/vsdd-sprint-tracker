/**
 * SessionAuthenticator tests (Phase 8, task 8.1/8.4).
 *
 * The authenticator re-reads the user + assignment on every request, so an
 * approval or suspension takes effect on the next request. Rejected/suspended
 * accounts lose access (session revoked, null principal); expired/unknown
 * sessions resolve to null.
 */
import { describe, expect, it } from 'vitest';
import type { UserAccount } from '../domain/accounts.js';
import { InMemoryIdentityRepository } from '../repository/inMemoryIdentityRepository.js';
import { SessionAuthenticator } from './authenticator.js';
import { generateSessionToken, hashSessionToken } from './session.js';

function user(id: string, status: UserAccount['status']): UserAccount {
  const now = new Date().toISOString();
  return {
    id,
    email: `${id}@example.com`,
    displayName: `User ${id}`,
    passwordHash: '$argon2id$fake',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

async function setup(status: UserAccount['status'], expiresInMs = 3600_000) {
  const repo = new InMemoryIdentityRepository();
  await repo.insertUser(user('u1', status));
  await repo.upsertAssignment({
    id: 'u1',
    userId: 'u1',
    programmeId: 'vsdd',
    teamIds: ['mmm-a'],
    roles: ['TEAM_LEAD'],
    updatedAt: new Date().toISOString(),
  });
  const token = generateSessionToken();
  await repo.createSession({
    id: hashSessionToken(token),
    userId: 'u1',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });
  const authenticator = new SessionAuthenticator(repo, repo, repo);
  return { repo, token, authenticator };
}

describe('SessionAuthenticator', () => {
  it('resolves a valid session into a principal with roles + assignment', async () => {
    const { authenticator, token } = await setup('ACTIVE');
    const principal = await authenticator.authenticate(token);
    expect(principal).not.toBeNull();
    expect(principal?.subject).toBe('u1');
    expect(principal?.status).toBe('ACTIVE');
    expect(principal?.roles).toEqual(['TEAM_LEAD']);
    expect(principal?.assignedTeamIds).toEqual(['mmm-a']);
  });

  it('returns a PENDING principal (so /me can route) but with pending status', async () => {
    const { authenticator, token } = await setup('PENDING');
    const principal = await authenticator.authenticate(token);
    expect(principal?.status).toBe('PENDING');
  });

  it('returns null for a missing token', async () => {
    const { authenticator } = await setup('ACTIVE');
    expect(await authenticator.authenticate(undefined)).toBeNull();
  });

  it('returns null for an unknown token', async () => {
    const { authenticator } = await setup('ACTIVE');
    expect(await authenticator.authenticate('not-a-real-token')).toBeNull();
  });

  it('returns null for an expired session', async () => {
    const { authenticator, token } = await setup('ACTIVE', -1000);
    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('denies a suspended account and revokes its sessions', async () => {
    const { authenticator, token, repo } = await setup('ACTIVE');
    await repo.updateUserStatus('u1', 'SUSPENDED', new Date().toISOString());
    expect(await authenticator.authenticate(token)).toBeNull();
    // Session revoked as a side effect (defence in depth).
    expect(await repo.getSession(hashSessionToken(token))).toBeNull();
  });
});
