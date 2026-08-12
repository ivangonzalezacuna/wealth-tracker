/**
 * Google Drive AppData file operations.
 *
 * Uses the Drive REST API v3 to store/retrieve the SQLite database file in
 * the hidden per-app "appDataFolder". Each OAuth application has its own
 * isolated AppData space, so dev and prod environments are fully separate.
 *
 * The database is stored as a single file named "wealth-tracker.db".
 */

import { getToken } from '../auth/google';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const DB_FILENAME = 'wealth-tracker.db';

interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
}

// ── Retry helper ──────────────────────────────────────────────────

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

/**
 * Execute a fetch-returning thunk with exponential backoff for transient
 * network and server errors (5xx, 429). Non-retryable errors (4xx except 429)
 * are thrown immediately so callers can react to auth/not-found failures
 * without delay.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with full jitter: random(0, base * 2^attempt)
      const cap = RETRY_BASE_MS * Math.pow(2, attempt);
      const delay = Math.random() * cap;
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Retry only on retryable HTTP status errors or network-level failures
      // (TypeError from fetch when offline). Other errors are re-thrown immediately.
      const isRetryable =
        err instanceof RetryableError || (err instanceof TypeError && attempt < MAX_RETRIES);
      if (!isRetryable) throw err;
    }
  }
  throw lastErr;
}

/** Sentinel error used internally to signal a retryable HTTP status. */
class RetryableError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Checked fetch: throws RetryableError for retryable HTTP statuses so
 * withRetry can distinguish them from permanent failures.
 */
async function checkedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok && RETRY_STATUSES.has(res.status)) {
    const body = await res.text().catch(() => '');
    throw new RetryableError(res.status, `Drive API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

// ── File discovery ────────────────────────────────────────────────

function pickCanonicalDbFile(files: DriveFile[]): DriveFile | null {
  if (files.length === 0) return null;
  const sorted = [...files].sort((a, b) => {
    const modifiedDiff = new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
    if (modifiedDiff !== 0) return modifiedDiff;
    const nameDiff = a.name.localeCompare(b.name);
    if (nameDiff !== 0) return nameDiff;
    return a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}

/** Find the DB file in appDataFolder. Returns file metadata or null. */
export async function findDbFile(): Promise<DriveFile | null> {
  return withRetry(async () => {
    const token = await getToken();
    const query = encodeURIComponent(`name='${DB_FILENAME}' and trashed=false`);
    const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`;
    const res = await checkedFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive list error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data.files)) {
      throw new Error(
        `Drive list response missing files array: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    const files: DriveFile[] = data.files;
    return pickCanonicalDbFile(files);
  });
}

// ── Download ──────────────────────────────────────────────────────

/** Download the DB file from AppData. Returns the binary content or null if not found. */
export async function downloadDbFile(): Promise<{ data: Uint8Array; modifiedTime: string } | null> {
  const file = await findDbFile();
  if (!file) return null;
  return withRetry(async () => {
    const token = await getToken();
    const url = `${DRIVE_API}/files/${file.id}?alt=media`;
    const res = await checkedFetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // 404 means file was deleted between findDbFile and download; not retryable.
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Drive download error: ${res.status} ${await res.text()}`);
    }
    const buf = await res.arrayBuffer();
    return { data: new Uint8Array(buf), modifiedTime: file.modifiedTime };
  });
}

// ── Upload ────────────────────────────────────────────────────────

/**
 * Upload the DB file to AppData.
 * Creates the file on first upload, updates it on subsequent uploads.
 * Uses multipart upload for simplicity (metadata + binary in one request).
 */
export async function uploadDbFile(data: Uint8Array): Promise<string> {
  const existing = await findDbFile();

  if (existing) {
    // Update existing file (PATCH with media)
    return withRetry(async () => {
      const token = await getToken();
      const url = `${UPLOAD_API}/files/${existing.id}?uploadType=media&fields=id%2CmodifiedTime`;
      const res = await checkedFetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-sqlite3',
        },
        body: data as BodyInit,
      });
      if (!res.ok) throw new Error(`Drive upload error: ${res.status} ${await res.text()}`);
      const result = await res.json();
      return result.modifiedTime || new Date().toISOString();
    });
  } else {
    // Create new file in appDataFolder (multipart)
    return withRetry(async () => {
      const token = await getToken();
      const metadata = JSON.stringify({
        name: DB_FILENAME,
        parents: ['appDataFolder'],
      });

      const boundary = '----WealthTrackerBoundary' + Date.now();
      const bodyParts = [
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        metadata,
        `\r\n--${boundary}\r\n`,
        'Content-Type: application/x-sqlite3\r\n\r\n',
      ].join('');

      // Build multipart body with binary
      const encoder = new TextEncoder();
      const prefix = encoder.encode(bodyParts);
      const suffix = encoder.encode(`\r\n--${boundary}--`);
      const combined = new Uint8Array(prefix.length + data.length + suffix.length);
      combined.set(prefix, 0);
      combined.set(data, prefix.length);
      combined.set(suffix, prefix.length + data.length);

      const url = `${UPLOAD_API}/files?uploadType=multipart&fields=id%2CmodifiedTime`;
      const res = await checkedFetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: combined as BodyInit,
      });
      if (!res.ok) throw new Error(`Drive create error: ${res.status} ${await res.text()}`);
      const result = await res.json();
      return result.modifiedTime || new Date().toISOString();
    });
  }
}

// ── Version check (lightweight) ───────────────────────────────────

/**
 * Get the modifiedTime of the cloud DB file without downloading it.
 * Returns null if no file exists yet.
 */
export async function getCloudModifiedTime(): Promise<string | null> {
  const file = await findDbFile();
  return file?.modifiedTime ?? null;
}
