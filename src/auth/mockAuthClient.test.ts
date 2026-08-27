/**
 * Mock auth client behaviour (Phase 8 frontend).
 *
 * Mirrors the backend rules the UI relies on: registration -> PENDING,
 * duplicate email rejected, PENDING can sign in, admin approval/assignment,
 * non-admin refused, and an admin cannot act on their own account.
 */
import { describe, expect, it } from 'vitest';
import { AuthError } from './authClient';
import { createMockAuthClient } from './mockAuthClient';

describe('createMockAuthClient', () => {
  it('registers a PENDING account and rejects a duplicate email', async () => {
    const client = createMockAuthClient();
    const user = await client.register({
      displayName: 'New Person',
      email: 'new@vsdd.test',
      password: 'password123',
    });
    expect(user.status).toBe('PENDING');
    await expect(
      client.register({ displayName: 'Dup', email: 'new@vsdd.test', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('rejects a weak password', async () => {
    const client = createMockAuthClient();
    await expect(
      client.register({ displayName: 'X', email: 'x@vsdd.test', password: 'short' }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('lets a PENDING user sign in and reports PENDING status', async () => {
    const client = createMockAuthClient();
    const principal = await client.login({ email: 'pending@vsdd.test', password: 'password123' });
    expect(principal.status).toBe('PENDING');
    expect(await client.getMe()).toMatchObject({ status: 'PENDING' });
  });

  it('rejects a wrong password with AUTH_FAILED', async () => {
    const client = createMockAuthClient();
    await expect(
      client.login({ email: 'lead@vsdd.test', password: 'nope' }),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });

  it('refuses admin actions for a non-admin', async () => {
    const client = createMockAuthClient({ initialUserEmail: 'lead@vsdd.test' });
    await expect(client.listUsers('PENDING')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('lets an admin approve a pending user with an assignment', async () => {
    const client = createMockAuthClient({ initialUserEmail: 'admin@vsdd.test' });
    const pending = await client.listUsers('PENDING');
    const target = pending.find((u) => u.email === 'pending@vsdd.test')!;
    const approved = await client.approve(target.id, {
      programmeId: 'vsdd',
      teamIds: ['mmm-a'],
      roles: ['TEAM_LEAD'],
    });
    expect(approved.status).toBe('ACTIVE');
    expect(approved.roles).toEqual(['TEAM_LEAD']);
  });

  it('requires at least one role to approve', async () => {
    const client = createMockAuthClient({ initialUserEmail: 'admin@vsdd.test' });
    const target = (await client.listUsers('PENDING')).find((u) => u.email === 'pending@vsdd.test')!;
    await expect(
      client.approve(target.id, { programmeId: 'vsdd', teamIds: [], roles: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('forbids an admin acting on their own account', async () => {
    const client = createMockAuthClient({ initialUserEmail: 'admin@vsdd.test' });
    const admin = (await client.listUsers('ACTIVE')).find((u) => u.email === 'admin@vsdd.test')!;
    await expect(client.suspend(admin.id)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('suspends an active user and then refuses their login', async () => {
    const client = createMockAuthClient({ initialUserEmail: 'admin@vsdd.test' });
    const lead = (await client.listUsers('ACTIVE')).find((u) => u.email === 'lead@vsdd.test')!;
    await client.suspend(lead.id);
    await expect(
      client.login({ email: 'lead@vsdd.test', password: 'password123' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_INACTIVE' });
  });
});
