import { PROFILE_MAX_RECORDS, PROFILE_RETENTION_MS, type ProfileRecord } from './types';

const DATABASE_NAME = 'wealth-tracker-profiler';
const DATABASE_VERSION = 1;
const RECORD_STORE = 'records';
const META_STORE = 'metadata';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        const records = database.createObjectStore(RECORD_STORE, { keyPath: 'id' });
        records.createIndex('timestamp', 'timestamp');
        records.createIndex('appVersion', 'appVersion');
        records.createIndex('buildId', 'buildId');
        records.createIndex('runId', 'runId');
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open profiler storage.'));
    request.onblocked = () =>
      reject(new Error('Profiler storage upgrade is blocked by another tab.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error('Profiler storage transaction failed.'));
  });
}

export async function readRecords(): Promise<ProfileRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORD_STORE, 'readonly');
    const done = transactionDone(transaction);
    const request = transaction.objectStore(RECORD_STORE).getAll() as IDBRequest<ProfileRecord[]>;
    const records = await new Promise<ProfileRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('Could not read profiler records.'));
    });
    await done;
    return records;
  } finally {
    database.close();
  }
}

export async function writeRecords(records: ProfileRecord[], now = Date.now()): Promise<void> {
  if (records.length === 0) return;
  await pruneRecords(now);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORD_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(RECORD_STORE);
    for (const record of records) store.put(record);
    await done;
  } finally {
    database.close();
  }
  await pruneRecords(now);
}

export async function pruneRecords(now = Date.now()): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORD_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(RECORD_STORE);
    const timestamp = store.index('timestamp');
    const cutoff = now - PROFILE_RETENTION_MS;
    const liveCountRequest = timestamp.count(IDBKeyRange.lowerBound(cutoff));
    liveCountRequest.onsuccess = () => {
      let overflow = Math.max(0, liveCountRequest.result - PROFILE_MAX_RECORDS);
      const cursorRequest = timestamp.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        const record = cursor.value as ProfileRecord;
        if (record.timestamp < cutoff) {
          cursor.delete();
        } else if (overflow > 0) {
          cursor.delete();
          overflow--;
        }
        cursor.continue();
      };
    };
    await done;
  } finally {
    database.close();
  }
}

export async function recordSessionStart(timestamp = Date.now()): Promise<number | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(META_STORE, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(META_STORE);
    const request = store.get('lastSessionStart') as IDBRequest<
      { key: string; timestamp: number } | undefined
    >;
    const previous = await new Promise<number | null>((resolve, reject) => {
      request.onsuccess = () => {
        const previousValue = request.result?.timestamp;
        store.put({ key: 'lastSessionStart', timestamp });
        resolve(typeof previousValue === 'number' ? previousValue : null);
      };
      request.onerror = () =>
        reject(request.error ?? new Error('Could not read profiler session metadata.'));
    });
    await done;
    return previous;
  } finally {
    database.close();
  }
}

export async function getStorageStatus(): Promise<{
  count: number;
  oldestTimestamp: number | null;
}> {
  const records = await readRecords();
  return {
    count: records.length,
    oldestTimestamp: records.reduce<number | null>(
      (oldest, record) =>
        oldest === null || record.timestamp < oldest ? record.timestamp : oldest,
      null,
    ),
  };
}
