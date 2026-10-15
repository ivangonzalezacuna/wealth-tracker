import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractSnapshotPdf, PDF_LIMITS } from './snapshotPdf';
import { syntheticStatementLines } from '../../tests/fixtures/snapshot-import/synthetic';
import { snapshotParsers } from './snapshotParsers';
import {
  fictionalBalanceParser,
  fictionalBalanceLines,
} from '../../tests/fixtures/snapshot-import/balanceParser';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn(), GlobalWorkerOptions: { workerSrc: '' } }));
vi.mock('pdfjs-dist', () => mocks);
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: '/assets/fake-pdf-worker.mjs',
}));
const file = () => new File(['%PDF-fake fixture'], 'fake.pdf', { type: 'application/pdf' });

function documentTask(lines = syntheticStatementLines(), numPages = lines.length) {
  const cleanup = vi.fn();
  const destroy = vi.fn().mockResolvedValue(undefined);
  const task = {
    destroy,
    promise: Promise.resolve({
      numPages,
      getPage: vi.fn(async (n: number) => ({
        cleanup,
        streamTextContent: () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue({
                items: (lines[n - 1] || []).map((str, i) => ({
                  str,
                  transform: [1, 0, 0, 1, 30, 800 - i * 18],
                })),
              });
              controller.close();
            },
          }),
      })),
    }),
  };
  mocks.getDocument.mockReturnValue(task);
  return { cleanup, destroy };
}

afterEach(() => {
  snapshotParsers.splice(1);
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe('bounded local PDF extraction', () => {
  it('extracts a registered non-ETF report through the same bounded PDF reader', async () => {
    snapshotParsers.push(fictionalBalanceParser);
    const { destroy } = documentTask([fictionalBalanceLines]);
    expect(await extractSnapshotPdf(file(), new AbortController().signal)).toMatchObject({
      documentType: fictionalBalanceParser.id,
      balances: { closing: 1234.56 },
      positions: [],
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('reads local bytes through a same-origin worker and releases each page and document', async () => {
    const { cleanup, destroy } = documentTask();
    expect((await extractSnapshotPdf(file(), new AbortController().signal)).positions).toHaveLength(
      7,
    );
    expect(mocks.GlobalWorkerOptions.workerSrc).toBe('/assets/fake-pdf-worker.mjs');
    expect(mocks.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.any(Uint8Array),
        disableFontFace: true,
        useWasm: false,
        stopAtErrors: true,
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it('rejects extension, MIME, signature and size before parsing', async () => {
    const signal = new AbortController().signal;
    await expect(extractSnapshotPdf(new File(['%PDF-'], 'fake.txt'), signal)).rejects.toThrow(
      'Choose a PDF',
    );
    await expect(
      extractSnapshotPdf(new File(['%PDF-'], 'fake.pdf', { type: 'text/plain' }), signal),
    ).rejects.toThrow('Choose a PDF');
    await expect(extractSnapshotPdf(new File(['not-pdf'], 'fake.pdf'), signal)).rejects.toThrow(
      'signature',
    );
    const large = new File(['%PDF-'], 'large.pdf');
    Object.defineProperty(large, 'size', { value: PDF_LIMITS.bytes + 1 });
    await expect(extractSnapshotPdf(large, signal)).rejects.toThrow('10 MiB');
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
  it('rejects too many pages and image-only PDFs while destroying resources', async () => {
    const { destroy } = documentTask([], 21);
    await expect(extractSnapshotPdf(file(), new AbortController().signal)).rejects.toThrow(
      '20-page',
    );
    expect(destroy).toHaveBeenCalledOnce();
    documentTask([[]]);
    await expect(extractSnapshotPdf(file(), new AbortController().signal)).rejects.toThrow(
      'No readable text',
    );
  });
  it('rejects oversized text streams and releases the worker', async () => {
    const { destroy } = documentTask([['x'.repeat(PDF_LIMITS.characters + 1)]]);
    await expect(extractSnapshotPdf(file(), new AbortController().signal)).rejects.toThrow(
      'processing limit',
    );
    expect(destroy).toHaveBeenCalledOnce();
  });
  it('reports encrypted and corrupt PDFs explicitly', async () => {
    for (const [name, message] of [
      ['PasswordException', 'Password-protected'],
      ['InvalidPDFException', 'Corrupt fixture'],
    ]) {
      const destroy = vi.fn().mockResolvedValue(undefined);
      mocks.getDocument.mockImplementationOnce(() => ({
        destroy,
        promise: Promise.reject(Object.assign(new Error('Corrupt fixture'), { name })),
      }));
      await expect(extractSnapshotPdf(file(), new AbortController().signal)).rejects.toThrow(
        message,
      );
      expect(destroy).toHaveBeenCalledOnce();
    }
  });
  it('honors pre-aborted requests without starting a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractSnapshotPdf(file(), controller.signal)).rejects.toThrow('cancelled');
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('enforces the deadline even when reading bytes has not completed', async () => {
    vi.useFakeTimers();
    const pending = file();
    vi.spyOn(pending, 'arrayBuffer').mockReturnValue(new Promise(() => {}));
    const result = extractSnapshotPdf(pending, new AbortController().signal);
    const assertion = expect(result).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(PDF_LIMITS.milliseconds);
    await assertion;
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });

  it('cancels a pending loading task and destroys it once', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    mocks.getDocument.mockReturnValue({ promise: new Promise(() => {}), destroy });
    const controller = new AbortController();
    const result = extractSnapshotPdf(file(), controller.signal);
    const assertion = expect(result).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalled());
    controller.abort();
    await assertion;
    expect(destroy).toHaveBeenCalledOnce();
  });
});
