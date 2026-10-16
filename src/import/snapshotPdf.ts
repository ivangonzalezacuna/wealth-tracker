import { parseSnapshotStatement } from './snapshotParsers';
import type { PdfTextPage, SnapshotStatement } from './snapshotStatement';

export const PDF_LIMITS = {
  bytes: 10 * 1024 * 1024,
  pages: 20,
  items: 25_000,
  characters: 1_000_000,
  milliseconds: 30_000,
};

export async function extractSnapshotPdf(
  file: File,
  signal: AbortSignal,
): Promise<SnapshotStatement> {
  if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf'))
    throw new Error('Choose a PDF file.');
  if (file.size > PDF_LIMITS.bytes) throw new Error('PDF exceeds the 10 MiB limit.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(() => controller.abort(), PDF_LIMITS.milliseconds);
  const check = () => {
    if (controller.signal.aborted)
      throw new Error('PDF import cancelled or timed out. Retry or enter values manually.');
  };
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    check();
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () =>
        reject(new Error('PDF import cancelled or timed out. Retry or enter values manually.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([operation, cancelled]);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
    }
  };
  let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
  let destruction: Promise<void> | undefined;
  const destroy = () => {
    destruction ||= task?.destroy();
  };
  controller.signal.addEventListener('abort', destroy, { once: true });
  try {
    const bytes = new Uint8Array(await bounded(file.arrayBuffer()));
    check();
    if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-')
      throw new Error('This file does not have a valid PDF signature.');
    const [pdf, worker] = await bounded(
      Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]),
    );
    check();
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    task = pdf.getDocument({
      data: bytes,
      useSystemFonts: false,
      stopAtErrors: true,
      disableFontFace: true,
      useWasm: false,
      verbosity: 0,
    });
    const document = await bounded(task.promise);
    check();
    if (document.numPages > PDF_LIMITS.pages) throw new Error('PDF exceeds the 20-page limit.');
    const pages: PdfTextPage[] = [];
    let itemCount = 0;
    let characterCount = 0;
    for (let n = 1; n <= document.numPages; n++) {
      check();
      const page = await bounded(document.getPage(n));
      const stream = page.streamTextContent();
      const reader = stream.getReader();
      const items: PdfTextPage['items'] = [];
      try {
        while (true) {
          check();
          const chunk = await bounded(reader.read());
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!('str' in item)) continue;
            itemCount++;
            characterCount += item.str.length;
            if (itemCount > PDF_LIMITS.items || characterCount > PDF_LIMITS.characters)
              throw new Error('PDF text exceeds the processing limit.');
            items.push({ text: item.str, x: item.transform[4], y: item.transform[5] });
          }
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
        page.cleanup();
      }
      pages.push({ items });
    }
    check();
    if (!pages.some((p) => p.items.some((i) => i.text.trim())))
      throw new Error(
        'No readable text found. Scanned PDFs require manual entry; OCR is not supported.',
      );
    return parseSnapshotStatement(pages);
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('PDF import cancelled or timed out. Retry or enter values manually.');
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('Password-protected PDFs are not supported. Use manual entry.');
    throw new Error(
      error instanceof Error ? error.message : 'Unable to read PDF. Use manual entry.',
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', destroy);
    destroy();
    await destruction;
  }
}
