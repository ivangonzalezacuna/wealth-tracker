import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import {
  getStorageStatus,
  pruneRecords,
  readRecords,
  recordSessionStart,
  writeRecords,
} from './store';
import { PROFILE_MAX_RECORDS, PROFILE_RETENTION_MS, type ProfileRecord } from './types';

function makeRecord(id: string, timestamp: number, appVersion = '1.0.0'): ProfileRecord {
  return {
    id,
    timestamp,
    appVersion,
    buildId: `build-${appVersion}`,
    runId: `run-${id}`,
    profilerSchemaVersion: 1,
    category: 'app',
    name: 'test-event',
  };
}

describe('performance profile storage', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retains measurements from multiple app releases', async () => {
    await writeRecords([makeRecord('old-release', 1_000, '1.0.0')], 1_000);
    await writeRecords([makeRecord('new-release', 2_000, '1.1.0')], 2_000);

    const records = await readRecords();
    expect(records.map((record) => record.appVersion).sort()).toEqual(['1.0.0', '1.1.0']);
  });

  it('removes expired records after 90 days', async () => {
    const oldTimestamp = 1_000;
    await writeRecords([makeRecord('expired', oldTimestamp)], oldTimestamp);
    const now = oldTimestamp + PROFILE_RETENTION_MS + 1;
    await writeRecords([makeRecord('current', now)], now);

    expect((await readRecords()).map((record) => record.id)).toEqual(['current']);
  });

  it('prunes the oldest records when the 10,000-record cap is exceeded', async () => {
    const now = Date.now();
    const records = Array.from({ length: PROFILE_MAX_RECORDS + 1 }, (_, index) =>
      makeRecord(`record-${index}`, now - PROFILE_MAX_RECORDS + index),
    );
    await writeRecords(records, now);

    const stored = await readRecords();
    expect(stored).toHaveLength(PROFILE_MAX_RECORDS);
    expect(stored.some((record) => record.id === 'record-0')).toBe(false);
    expect(stored.some((record) => record.id === `record-${PROFILE_MAX_RECORDS}`)).toBe(true);
    expect(await getStorageStatus()).toMatchObject({ count: PROFILE_MAX_RECORDS });
  });

  it('records previous profiler session start times', async () => {
    expect(await recordSessionStart(100)).toBeNull();
    expect(await recordSessionStart(250)).toBe(100);
  });

  it('keeps the exact retention boundary and removes expired incoming records', async () => {
    const now = PROFILE_RETENTION_MS + 10_000;
    await writeRecords(
      [
        makeRecord('expired', now - PROFILE_RETENTION_MS - 1),
        makeRecord('boundary', now - PROFILE_RETENTION_MS),
        makeRecord('current', now),
      ],
      now,
    );
    expect((await readRecords()).map((record) => record.id).sort()).toEqual([
      'boundary',
      'current',
    ]);
    await pruneRecords(now + 1);
    expect((await readRecords()).map((record) => record.id)).toEqual(['current']);
  });

  it('enforces the cap atomically across concurrent batches and duplicate IDs', async () => {
    const now = Date.now();
    const initial = Array.from({ length: PROFILE_MAX_RECORDS }, (_, index) =>
      makeRecord(`initial-${index}`, now - PROFILE_MAX_RECORDS + index),
    );
    await writeRecords(initial, now);
    await Promise.all([
      writeRecords([makeRecord('batch-a', now), makeRecord('initial-9999', now)], now),
      writeRecords([makeRecord('batch-b', now + 1)], now + 1),
    ]);
    const records = await readRecords();
    expect(records).toHaveLength(PROFILE_MAX_RECORDS);
    expect(records.some((record) => record.id === 'initial-0')).toBe(false);
    expect(records.some((record) => record.id === 'initial-1')).toBe(false);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'batch-a' }),
        expect.objectContaining({ id: 'batch-b' }),
        expect.objectContaining({ id: 'initial-9999', timestamp: now }),
      ]),
    );
  });
});
