/**
 * Sharp zoom for pages kept as PDF: draws only the visible part of the vector page
 * at the screen's real resolution, so text is crisp at every zoom level.
 * pdf.js is loaded only when a reader first zooms in.
 */
import { API_ORIGIN, tokenStore } from '../../services/api';
import { TENANT_SLUG } from '../../services/tenant';

let lib = null;
async function pdfjs() {
  if (!lib) {
    lib = (async () => {
      const m = await import('pdfjs-dist/build/pdf.min.mjs');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      m.GlobalWorkerOptions.workerSrc = worker;
      return m;
    })();
  }
  return lib;
}

const docs = new Map(); // url -> Promise<PDFPageProxy>

/** First page of a single-page PDF (cached). */
export function loadPdfPage(url) {
  if (!docs.has(url)) {
    docs.set(url, (async () => {
      const m = await pdfjs();
      const headers = {};
      if (TENANT_SLUG) headers['X-Tenant'] = TENANT_SLUG;
      const tok = tokenStore?.get?.();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const doc = await m.getDocument({ url: `${API_ORIGIN}${url}`, httpHeaders: headers, isEvalSupported: false, disableAutoFetch: true }).promise;
      return doc.getPage(1);
    })().catch((e) => { docs.delete(url); throw e; }));
    if (docs.size > 12) docs.delete(docs.keys().next().value); // keep memory small
  }
  return docs.get(url);
}

/**
 * Render the part of the page visible in a box of (boxW × boxH) CSS px.
 * The page is shown at (x, y) with displayed width `pageW` CSS px.
 * Returns a cancel function.
 */
export function renderVisible(pdfPage, canvas, { boxW, boxH, x, y, pageW }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const unit = pdfPage.getViewport({ scale: 1 });
  const scale = (pageW / unit.width) * dpr;
  const vp = pdfPage.getViewport({ scale, offsetX: x * dpr, offsetY: y * dpr });
  canvas.width = Math.max(1, Math.round(boxW * dpr));
  canvas.height = Math.max(1, Math.round(boxH * dpr));
  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const task = pdfPage.render({ canvasContext: ctx, canvas, viewport: vp, background: '#ffffff' });
  return { promise: task.promise, cancel: () => { try { task.cancel(); } catch { /* done */ } } };
}
