import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import { buildColumnLayout } from './column-layout';
import type { OcrColumn, OcrToken } from '@/types/ocr';

interface PdfTextItem {
  str?: string;
  width?: number;
  height?: number;
  transform?: number[];
}

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

let currentDoc: pdfjsLib.PDFDocumentProxy | null = null;

export async function loadPdf(data: ArrayBuffer): Promise<number> {
  if (currentDoc) {
    currentDoc.destroy();
  }
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data) });
  currentDoc = await loadingTask.promise;
  return currentDoc.numPages;
}

export async function renderPage(
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.5
): Promise<void> {
  if (!currentDoc) throw new Error('No PDF loaded');
  
  const page = await currentDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get canvas context');
  
  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;
}

export async function renderPageToDataUrl(
  pageNumber: number,
  scale: number = 0.4
): Promise<string> {
  if (!currentDoc) throw new Error('No PDF loaded');
  
  const page = await currentDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot get canvas context');
  
  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;
  
  const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
  canvas.remove();
  return dataUrl;
}

/**
 * Renders a PDF.js text layer into a container div, enabling native
 * text selection on top of the canvas.
 */
export async function renderTextLayer(
  pageNumber: number,
  container: HTMLDivElement,
  scale: number = 1.5
): Promise<void> {
  if (!currentDoc) throw new Error('No PDF loaded');

  const page = await currentDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const textContent = await page.getTextContent();

  // Clear previous text layer content
  container.innerHTML = '';
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;

  // Use PDF.js TextLayer class (v4.x API)
  const textLayer = new TextLayer({
    textContentSource: textContent,
    container,
    viewport,
  });

  await textLayer.render();
}

export function getPageCount(): number {
  return currentDoc?.numPages ?? 0;
}

export async function extractTextFromPage(pageNumber: number): Promise<{
  text: string;
  columns: OcrColumn[];
  tokens: OcrToken[];
}> {
  if (!currentDoc) throw new Error('No PDF loaded');

  const page = await currentDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  const tokens = (content.items as PdfTextItem[])
    .map((item): OcrToken | null => {
      if (typeof item?.str !== 'string') return null;

      const text = item.str.trim();
      if (!text) return null;

      const transform = item.transform as number[] | undefined;
      const width = Math.max(1, Number(item.width) || 0);
      const height = Math.max(
        1,
        Math.abs(Number(item.height) || Number(transform?.[0]) || Number(transform?.[3]) || 0)
      );
      const x = Number(transform?.[4]) || 0;
      const y = Math.max(0, viewport.height - (Number(transform?.[5]) || 0) - height);

      return {
        text,
        confidence: 100,
        bbox: { x, y, width, height },
      };
    })
    .filter((token): token is OcrToken => token !== null);

  const layout = buildColumnLayout(tokens);

  return {
    text: layout.text,
    columns: layout.columns,
    tokens,
  };
}

export function destroyPdf() {
  if (currentDoc) {
    currentDoc.destroy();
    currentDoc = null;
  }
}
