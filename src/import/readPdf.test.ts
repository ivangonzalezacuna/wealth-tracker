import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStatement } from './readPdf';
import { PdfValidationError } from './pdfStatement';
import { statementFixture, syntheticPdf } from '../../tests/e2e/fixtures/pdfStatement';

const mocks = vi.hoisted(() => ({
  terminate: vi.fn(),
  workerDestroy: vi.fn(),
  taskDestroy: vi.fn().mockResolvedValue(undefined),
  getDocument: vi.fn(),
}));
vi.mock('pdfjs-dist/build/pdf.worker.mjs?worker', () => ({
  default: class {
    terminate = mocks.terminate;
  },
}));
vi.mock('pdfjs-dist', () => ({
  PDFWorker: { create: () => ({ destroy: mocks.workerDestroy }) },
  getDocument: mocks.getDocument,
}));
const file = (data = syntheticPdf()) =>
  ({
    size: data.length,
    arrayBuffer: async () => data.buffer,
  }) as File;
function documentStub(lines = statementFixture()) {
  return {
    numPages: 2,
    getPermissions: vi.fn().mockResolvedValue(null),
    getPage: vi.fn(async (page: number) => ({
      cleanup: vi.fn(),
      streamTextContent: () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue({
              items: lines
                .filter((l) => l.page === page)
                .flatMap((l) =>
                  l.cells.map((c) => ({
                    str: c.text,
                    width: 50,
                    transform: [1, 0, 0, 1, c.x, l.y],
                  })),
                ),
            });
            controller.close();
          },
        }),
    })),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve(documentStub()),
    destroy: mocks.taskDestroy,
  });
});
afterEach(() => vi.useRealTimers());
describe('bounded PDF loading', () => {
  it('uses only bytes and matched worker with external resources disabled, then destroys both', async () => {
    const result = await readStatement(file(), new AbortController().signal);
    expect(result.total).toBe(1334.56);
    const options = mocks.getDocument.mock.calls[0][0];
    expect(options).toMatchObject({
      useWorkerFetch: false,
      useWasm: false,
      enableXfa: false,
      useSystemFonts: false,
      stopAtErrors: true,
      verbosity: 0,
    });
    expect(options.url).toBeUndefined();
    expect(options.cMapUrl).toBeUndefined();
    expect(options.standardFontDataUrl).toBeUndefined();
    await expect(new options.BinaryDataFactory().fetch()).rejects.toMatchObject({
      code: 'loading',
    });
    expect(mocks.terminate).toHaveBeenCalled();
    expect(mocks.workerDestroy).toHaveBeenCalled();
    expect(mocks.taskDestroy).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('rejects large files, invalid signatures and already-aborted inputs before worker startup', async () => {
    const signal = new AbortController().signal;
    await expect(readStatement({ size: 10 * 1024 * 1024 + 1 } as File, signal)).rejects.toThrow(
      PdfValidationError,
    );
    await expect(readStatement(file(new TextEncoder().encode('bad%%EOF')), signal)).rejects.toThrow(
      PdfValidationError,
    );
    await expect(readStatement(file(), AbortSignal.abort())).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(mocks.getDocument).not.toHaveBeenCalled();
  });
  it.each(['page limit', 'encrypted', 'character limit', 'item limit'])(
    'rejects %s and destroys processing',
    async (scenario) => {
      const doc = documentStub();
      if (scenario === 'page limit') doc.numPages = 21;
      if (scenario === 'encrypted') doc.getPermissions.mockResolvedValue([]);
      if (scenario === 'character limit' || scenario === 'item limit') {
        doc.getPage.mockResolvedValue({
          cleanup: vi.fn(),
          streamTextContent: () =>
            new ReadableStream({
              start(controller) {
                const item = {
                  str: scenario === 'character limit' ? 'x'.repeat(250001) : 'x',
                  width: 1,
                  transform: [1, 0, 0, 1, 1, 1],
                };
                controller.enqueue({
                  items: scenario === 'item limit' ? Array(30001).fill(item) : [item],
                });
                controller.close();
              },
            }),
        });
      }
      mocks.getDocument.mockReturnValue({
        promise: Promise.resolve(doc),
        destroy: mocks.taskDestroy,
      });
      await expect(readStatement(file(), new AbortController().signal)).rejects.toMatchObject({
        code: scenario === 'encrypted' ? 'password' : 'limit',
      });
      expect(mocks.terminate).toHaveBeenCalled();
      expect(mocks.taskDestroy).toHaveBeenCalled();
    },
  );
  it.each(['cancel', 'timeout', 'password'])(
    'terminates pending processing on %s',
    async (reason) => {
      vi.useFakeTimers();
      const task = {
        promise: new Promise(() => {}),
        destroy: mocks.taskDestroy,
        onPassword: () => {},
      };
      mocks.getDocument.mockReturnValue(task);
      const controller = new AbortController();
      const pending = readStatement(file(), controller.signal);
      const assertion = expect(pending).rejects.toMatchObject({
        code: reason === 'cancel' ? 'cancelled' : reason,
      });
      await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalled());
      if (reason === 'cancel') controller.abort();
      else if (reason === 'password') task.onPassword();
      else await vi.advanceTimersByTimeAsync(15000);
      await assertion;
      expect(mocks.terminate).toHaveBeenCalled();
      expect(mocks.workerDestroy).toHaveBeenCalled();
      expect(mocks.taskDestroy).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it('accepts valid header padding and trailing comments without imposing an extra EOF rule', async () => {
    const bytes = Uint8Array.from([
      0x20,
      0x0a,
      ...syntheticPdf(),
      ...new TextEncoder().encode('% comment\n'),
    ]);
    expect((await readStatement(file(bytes), new AbortController().signal)).cash).toBe(100);
  });
  it('preserves parser validation codes but sanitizes PDF.js exceptions', async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.reject(new Error('private document text and filename')),
      destroy: mocks.taskDestroy,
    });
    await expect(readStatement(file(), new AbortController().signal)).rejects.toMatchObject({
      code: 'loading',
    });
    const doc = documentStub();
    doc.getPage.mockResolvedValue({
      cleanup: vi.fn(),
      streamTextContent: () =>
        new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
    });
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve(doc),
      destroy: mocks.taskDestroy,
    });
    await expect(readStatement(file(), new AbortController().signal)).rejects.toMatchObject({
      code: 'text',
    });
    const lines = statementFixture();
    const total = lines.find((line) => line.cells.some((cell) => cell.text === 'GESAMT'))!;
    total.cells.at(-1)!.text = '1.334,57 EUR';
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve(documentStub(lines)),
      destroy: mocks.taskDestroy,
    });
    await expect(readStatement(file(), new AbortController().signal)).rejects.toMatchObject({
      code: 'summary',
    });
  });
});
