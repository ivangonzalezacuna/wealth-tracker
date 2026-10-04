import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import {
  PDF_ERROR,
  parseTradeRepublic,
  positionedLines,
  type Statement,
  type StatementLine,
} from './pdfStatement';

export async function readStatement(file: File, signal: AbortSignal): Promise<Statement> {
  if (!file.size || file.size > 10 * 1024 * 1024 || signal.aborted) throw new Error(PDF_ERROR);
  let worker: Worker | undefined;
  let pdfWorker: import('pdfjs-dist').PDFWorker | undefined;
  let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let abort = () => {};
  const guard = () => {
    if (stopped || signal.aborted) throw new Error(PDF_ERROR);
  };
  const timeout = new Promise<never>((_, reject) => {
    abort = () => {
      stopped = true;
      worker?.terminate();
      reject(new Error(PDF_ERROR));
    };
    timer = setTimeout(abort, 15000);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        guard();
        if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error(PDF_ERROR);
        if (!/%%EOF\s*$/.test(new TextDecoder().decode(bytes.subarray(-1024))))
          throw new Error(PDF_ERROR);
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
              throw new Error(PDF_ERROR);
            }
          },
          stopAtErrors: true,
          verbosity: 0,
          maxImageSize: 0,
        });
        task.onPassword = () => abort();
        const doc = await task.promise;
        guard();
        if (doc.numPages > 20 || (await doc.getPermissions()) !== null) throw new Error(PDF_ERROR);
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
                if (chars > 250000 || count > 30000) throw new Error(PDF_ERROR);
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
        return parseTradeRepublic(lines, doc.numPages);
      })(),
    ]);
  } catch {
    throw new Error(PDF_ERROR);
  } finally {
    stopped = true;
    clearTimeout(timer!);
    signal.removeEventListener('abort', abort);
    void task?.destroy().catch(() => {});
    pdfWorker?.destroy();
    worker?.terminate();
  }
}
