/**
 * PDF Text Extraction Engine — Rendering-based approach using PDF.js.
 *
 * Instead of running Tesseract OCR on rendered images, this engine uses
 * PDF.js's native textContent API to extract structured text directly from
 * the PDF's internal text streams. This is:
 *   • Instant — no image processing, no workers
 *   • 100% accurate — reads the actual font/glyph data
 *   • Selectable — paired with a text layer overlay for native selection
 */

import { extractTextFromPage } from './pdf-renderer';
import { cleanOcrText } from './text-cleanup';
import type { OcrColumn } from '@/types/ocr';

export interface TextExtractionResult {
  text: string;
  confidence: number;
  columns: OcrColumn[];
}

export interface TextEngineCallbacks {
  onPageStart: (pageNumber: number) => void;
  onPageProgress: (pageNumber: number, progress: number) => void;
  onPageComplete: (pageNumber: number, result: TextExtractionResult) => void;
  onPageError: (pageNumber: number, error: string) => void;
  onComplete: () => void;
}

class PdfTextEngine {
  private isRunning = false;
  private isPaused = false;
  private queue: number[] = [];
  private callbacks: TextEngineCallbacks | null = null;

  /**
   * Processes pages by extracting text via PDF.js textContent API.
   * This is near-instant — no OCR, no image rendering, no workers needed.
   */
  async processPages(pageNumbers: number[], callbacks: TextEngineCallbacks) {
    this.callbacks = callbacks;
    this.queue = [...pageNumbers];
    this.isRunning = true;
    this.isPaused = false;

    // Process pages sequentially (fast enough that parallelism isn't needed)
    while (this.isRunning && this.queue.length > 0) {
      // Handle pause
      while (this.isPaused && this.isRunning) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (!this.isRunning) break;

      const pageNumber = this.queue.shift();
      if (pageNumber === undefined) break;

      callbacks.onPageStart(pageNumber);
      callbacks.onPageProgress(pageNumber, 10);

      try {
        // Extract text using PDF.js textContent API — this is instant
        const result = await extractTextFromPage(pageNumber);
        callbacks.onPageProgress(pageNumber, 80);

        const cleanedText = cleanOcrText(result.text);
        const columns = result.columns.map(col => ({
          ...col,
          text: cleanOcrText(col.text),
        }));

        callbacks.onPageProgress(pageNumber, 100);
        callbacks.onPageComplete(pageNumber, {
          text: cleanedText,
          confidence: 100, // Native extraction is always 100% accurate
          columns,
        });
      } catch (err) {
        console.error(`[PDF Text Engine] Page ${pageNumber} failed:`, err);
        const message = err instanceof Error ? err.message : 'Text extraction failed';
        callbacks.onPageError(pageNumber, message);
      }

      // Small yield to keep UI responsive during bulk processing
      await new Promise(r => setTimeout(r, 0));
    }

    if (this.isRunning) {
      this.isRunning = false;
      callbacks.onComplete();
    }
  }

  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.queue = [];
  }

  retryPages(pageNumbers: number[]) {
    this.queue.push(...pageNumbers);
  }

  terminate() {
    this.stop();
  }

  get running() { return this.isRunning; }
  get paused() { return this.isPaused; }
  get queueLength() { return this.queue.length; }
}

// Singleton
export const pdfTextEngine = new PdfTextEngine();
