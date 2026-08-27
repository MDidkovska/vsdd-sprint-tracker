/**
 * Persistence-model invariants (design.md §4a). These lock the vendor-neutral
 * document definition so drift from the design is caught at test time.
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../config';
import {
  APPEND_ONLY_COLLECTIONS,
  buildUpcastChain,
  CURRENT_PAYLOAD_SCHEMA_VERSION,
  IMMUTABLE_COLLECTIONS,
  PERSISTENCE_MODEL,
  partitionKeyFor,
  type CollectionName,
  type PayloadUpcaster,
} from './persistence';

const ALL_COLLECTIONS: CollectionName[] = [
  'programmes',
  'streams',
  'teams',
  'sprints',
  'checkpoints',
  'assignments',
  'updates',
  'updateVersions',
  'decisions',
  'auditEvents',
];

describe('persistence model', () => {
  it('defines every required collection/aggregate', () => {
    for (const name of ALL_COLLECTIONS) {
      expect(PERSISTENCE_MODEL[name]).toBeDefined();
      expect(PERSISTENCE_MODEL[name].name).toBe(name);
    }
    expect(Object.keys(PERSISTENCE_MODEL).sort()).toEqual([...ALL_COLLECTIONS].sort());
  });

  it('partitions every collection by programmeId', () => {
    for (const c of Object.values(PERSISTENCE_MODEL)) {
      expect(c.partitionKeyPath).toBe('/programmeId');
    }
    expect(partitionKeyFor('vsdd')).toBe('vsdd');
  });

  it('marks every collection schema-versioned and gives each a primary-key index', () => {
    for (const c of Object.values(PERSISTENCE_MODEL)) {
      expect(c.schemaVersioned).toBe(true);
      const pk = c.indexes.find((ix) => ix.unique && ix.fields.includes('id'));
      expect(pk, `${c.name} needs a unique id index`).toBeDefined();
    }
  });

  it('only indexes envelope fields (rag.* is the sole permitted dotted path)', () => {
    for (const c of Object.values(PERSISTENCE_MODEL)) {
      for (const ix of c.indexes) {
        for (const field of ix.fields) {
          if (field.includes('.')) {
            expect(field.startsWith('rag.'), `${c.name}.${ix.name} indexes payload path ${field}`).toBe(true);
          }
          expect(field.startsWith('payload')).toBe(false);
        }
      }
    }
  });

  it('treats submitted versions and audit events as immutable/append-only', () => {
    expect(IMMUTABLE_COLLECTIONS).toContain('updateVersions');
    expect(IMMUTABLE_COLLECTIONS).toContain('auditEvents');
    expect(APPEND_ONLY_COLLECTIONS).toEqual(
      expect.arrayContaining(['updateVersions', 'auditEvents', 'decisions']),
    );
    expect(PERSISTENCE_MODEL.updateVersions.concurrency).toBe('APPEND_ONLY');
    expect(PERSISTENCE_MODEL.auditEvents.concurrency).toBe('APPEND_ONLY');
  });

  it('uses optimistic concurrency on the mutable draft aggregate', () => {
    expect(PERSISTENCE_MODEL.updates.concurrency).toBe('OPTIMISTIC_REVISION');
    expect(PERSISTENCE_MODEL.updates.immutable).toBe(false);
  });

  it('retains evidence indefinitely and archives (never deletes) teams/updates', () => {
    expect(PERSISTENCE_MODEL.updateVersions.retention.policy).toBe('RETAIN_INDEFINITELY');
    expect(PERSISTENCE_MODEL.auditEvents.retention.policy).toBe('RETAIN_INDEFINITELY');
    expect(PERSISTENCE_MODEL.decisions.retention.policy).toBe('RETAIN_INDEFINITELY');
    expect(PERSISTENCE_MODEL.teams.retention.policy).toBe('ARCHIVE_ON_TEAM_REMOVAL');
    expect(PERSISTENCE_MODEL.updates.retention.policy).toBe('ARCHIVE_ON_TEAM_REMOVAL');
    // No evidence collection uses a positive TTL.
    for (const c of Object.values(PERSISTENCE_MODEL)) {
      if (c.retention.policy !== 'TTL') expect(c.retention.ttlSeconds).toBeNull();
    }
  });
});

describe('schema-version compatibility', () => {
  it('tracks the single source-of-truth schema version', () => {
    expect(CURRENT_PAYLOAD_SCHEMA_VERSION).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('returns an empty upcast chain when stored version equals current', () => {
    expect(buildUpcastChain(1, 1, [])).toEqual([]);
  });

  it('chains registered upcasters from stored version up to current', () => {
    const upcasters: PayloadUpcaster[] = [
      { fromVersion: 1, toVersion: 2, upcast: (r) => r },
      { fromVersion: 2, toVersion: 3, upcast: (r) => r },
    ];
    const chain = buildUpcastChain(1, 3, upcasters);
    expect(chain.map((u) => `${u.fromVersion}->${u.toVersion}`)).toEqual(['1->2', '2->3']);
  });

  it('refuses to read a document newer than the reader', () => {
    expect(() => buildUpcastChain(3, 1, [])).toThrow(/newer than the reader/);
  });

  it('throws when an upcaster is missing in the chain', () => {
    expect(() => buildUpcastChain(1, 3, [{ fromVersion: 1, toVersion: 2, upcast: (r) => r }])).toThrow(
      /No upcaster registered/,
    );
  });
});
