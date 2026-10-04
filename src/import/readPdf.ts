import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import {
  PdfValidationError,
  parseTradeRepublic,
  positionedLines,
  type Statement,
  type StatementLine,
} from './pdfStatement';

export async function readStatement(file: File, signal: AbortSignal): Promise<Statement> {
  if (signal.aborted) throw new PdfValidationError('cancelled');
  if (!file.size) throw new PdfValidationError('file');
  if (file.size > 10 * 1024 * 1024) throw new PdfValidationError('size');
  let worker: Worker | undefined;
  let pdfWorker: import('pdfjs-dist').PDFWorker | undefined;
  let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let abort = () => {};
  let timedOut = false;
  let rejectPending: (error: PdfValidationError) => void = () => {};
  const guard = () => {
    if (stopped || signal.aborted) throw new PdfValidationError(timedOut ? 'timeout' : 'cancelled');
  };
  const timeout = new Promise<never>((_, reject) => {
    rejectPending = reject;
    abort = () => {
      stopped = true;
      worker?.terminate();
      reject(new PdfValidationError(timedOut ? 'timeout' : 'cancelled'));
    };
    timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, 15000);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        guard();
        // PDF.js accepts a header within the first 1,024 bytes and validates the trailer itself.
        if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-'))
          throw new PdfValidationError('file');
        const pdfjs = await import('pdfjs-dist');
        guard();
        worker = new PdfWorker();
        pdfWorker = pdfjs.PDFWorker.create({ port: worker, verbosity: 0 });
        task = pdfjs.getDocument({
          data: bytes,
          worker: pdfWorker,
          // PDF.js 6 removed dynamic eval. No viewer/sandbox or document scripts are loaded.
          useSystemFonts: false,
          disableFontFace: true,
          useWorkerFetch: false,
          cMapUrl: undefined,
          standardFontDataUrl: undefined,
          wasmUrl: undefined,
          useWasm: false,
          enableXfa: false,
          BinaryDataFactory: class {
            async fetch() {
              throw new PdfValidationError('loading');
            }
          },
          stopAtErrors: true,
          verbosity: 0,
          maxImageSize: 0,
        });
        task.onPassword = () => {
          stopped = true;
          worker?.terminate();
          // Reject the pending race without including the document or PDF.js error message.
          rejectPending(new PdfValidationError('password'));
        };
        const doc = await task.promise;
        guard();
        if (doc.numPages > 20) throw new PdfValidationError('limit');
        if ((await doc.getPermissions()) !== null) throw new PdfValidationError('password');
        const lines: StatementLine[] = [];
        let chars = 0;
        let count = 0;
        for (let page = 1; page <= doc.numPages; page++) {
          guard();
          const p = await doc.getPage(page);
          const stream = p.streamTextContent();
          const reader = stream.getReader();
          const items: { str: string; transform: number[]; width: number }[] = [];
          try {
            while (true) {
              guard();
              const chunk = await reader.read();
              if (chunk.done) break;
              for (const item of chunk.value.items) {
                if (!('str' in item)) continue;
                chars += item.str.length;
                count++;
                if (chars > 250000 || count > 30000) throw new PdfValidationError('limit');
                items.push(item);
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
          lines.push(...positionedLines(items, page));
          p.cleanup();
        }
        guard();
        if (!lines.length) throw new PdfValidationError('text');
        return parseTradeRepublic(lines, doc.numPages);
      })(),
    ]);
  } catch (error) {
    if (error instanceof PdfValidationError) throw error;
    throw new PdfValidationError('loading');
  } finally {
    stopped = true;
    clearTimeout(timer!);
    signal.removeEventListener('abort', abort);
    void task?.destroy().catch(() => {});
    pdfWorker?.destroy();
    worker?.terminate();
  }
}
