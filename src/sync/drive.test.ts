import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../auth/google', () => ({
  getToken: vi.fn(async () => 'test-token'),
}));

describe('uploadDbFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requests modifiedTime in the fields parameter when updating an existing file', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // findDbFile call
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [
              { id: 'file-1', name: 'wealth-tracker.db', modifiedTime: '2026-01-01T00:00:00.000Z' },
            ],
          }),
          { status: 200 },
        ),
      )
      // PATCH upload call
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'file-1', modifiedTime: '2026-01-01T00:00:05.000Z' }), {
          status: 200,
        }),
      );

    const { uploadDbFile } = await import('./drive');
    const modifiedTime = await uploadDbFile(new Uint8Array([1, 2, 3]));

    const patchCall = fetchSpy.mock.calls[1];
    expect(patchCall[0]).toContain('fields=');
    expect(patchCall[0]).toContain('modifiedTime');
    // Must return the server-assigned time, not a client fallback
    expect(modifiedTime).toBe('2026-01-01T00:00:05.000Z');
  });

  it('requests modifiedTime in the fields parameter when creating a new file', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      // findDbFile call - no existing file
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      // POST multipart upload call
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'file-new', modifiedTime: '2026-01-01T00:00:07.000Z' }), {
          status: 200,
        }),
      );

    const { uploadDbFile } = await import('./drive');
    const modifiedTime = await uploadDbFile(new Uint8Array([1, 2, 3]));

    const postCall = fetchSpy.mock.calls[1];
    expect(postCall[0]).toContain('fields=');
    expect(postCall[0]).toContain('modifiedTime');
    expect(modifiedTime).toBe('2026-01-01T00:00:07.000Z');
  });
});

describe('findDbFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('picks the most recently modified db file deterministically', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            {
              id: 'b',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'a',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-02-01T00:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { findDbFile } = await import('./drive');
    const file = await findDbFile();

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('fields=files(id,name,modifiedTime)'),
      expect.any(Object),
    );
    expect(file?.id).toBe('a');
  });

  it('breaks modifiedTime ties by id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          files: [
            {
              id: 'z',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-02-01T00:00:00.000Z',
            },
            {
              id: 'a',
              name: 'wealth-tracker.db',
              modifiedTime: '2026-02-01T00:00:00.000Z',
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { findDbFile } = await import('./drive');
    const file = await findDbFile();

    expect(file?.id).toBe('a');
  });
});
