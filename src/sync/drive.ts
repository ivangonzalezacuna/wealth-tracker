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

// ── File discovery ────────────────────────────────────────────────

/** Find the DB file in appDataFolder. Returns file metadata or null. */
export async function findDbFile(): Promise<DriveFile | null> {
  const token = await getToken();
  const query = encodeURIComponent(`name='${DB_FILENAME}' and trashed=false`);
  const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive list error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const files: DriveFile[] = data.files || [];
  return files.length > 0 ? files[0] : null;
}

// ── Download ──────────────────────────────────────────────────────

/** Download the DB file from AppData. Returns the binary content or null if not found. */
export async function downloadDbFile(): Promise<{ data: Uint8Array; modifiedTime: string } | null> {
  const file = await findDbFile();
  if (!file) return null;

  const token = await getToken();
  const url = `${DRIVE_API}/files/${file.id}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Drive download error: ${res.status} ${await res.text()}`);
  }
  const buf = await res.arrayBuffer();
  return { data: new Uint8Array(buf), modifiedTime: file.modifiedTime };
}

// ── Upload ────────────────────────────────────────────────────────

/**
 * Upload the DB file to AppData.
 * Creates the file on first upload, updates it on subsequent uploads.
 * Uses multipart upload for simplicity (metadata + binary in one request).
 */
export async function uploadDbFile(data: Uint8Array): Promise<string> {
  const token = await getToken();
  const existing = await findDbFile();

  if (existing) {
    // Update existing file (PATCH with media)
    const url = `${UPLOAD_API}/files/${existing.id}?uploadType=media`;
    const res = await fetch(url, {
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
  } else {
    // Create new file in appDataFolder (multipart)
    const metadata = JSON.stringify({
      name: DB_FILENAME,
      parents: ['appDataFolder'],
    });

    const boundary = '----WealthTrackerBoundary' + Date.now();
    const body = [
      `--${boundary}\r\n`,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      metadata,
      `\r\n--${boundary}\r\n`,
      'Content-Type: application/x-sqlite3\r\n\r\n',
    ].join('');

    // Build multipart body with binary
    const encoder = new TextEncoder();
    const prefix = encoder.encode(body);
    const suffix = encoder.encode(`\r\n--${boundary}--`);
    const combined = new Uint8Array(prefix.length + data.length + suffix.length);
    combined.set(prefix, 0);
    combined.set(data, prefix.length);
    combined.set(suffix, prefix.length + data.length);

    const url = `${UPLOAD_API}/files?uploadType=multipart`;
    const res = await fetch(url, {
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
