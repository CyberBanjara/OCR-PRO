import { createWorker, type Worker } from 'tesseract.js';
import { renderPageForOcr, extractTextFromPage } from './pdf-renderer';
import { cleanOcrText } from './text-cleanup';
import { buildColumn, buildColumnLayout } from './column-layout';
import type { OcrColumn, OcrToken } from '@/types/ocr';

interface OcrResult {
  text: string;
  confidence: number;
  columns: OcrColumn[];
}

interface OcrEngineCallbacks {
  onPageStart: (pageNumber: number) => void;
  onPageProgress: (pageNumber: number, progress: number) => void;
  onPageComplete: (pageNumber: number, result: OcrResult) => void;
  onPageError: (pageNumber: number, error: string) => void;
  onComplete: () => void;
}

const PAGE_TIMEOUT_MS = 30_000; // 30 second timeout per page
const COLUMN_TIMEOUT_MS = 20_000;
const MIN_TEXT_LENGTH = 50; // Minimum chars to consider native extraction successful
const COLUMN_RERUN_MIN_COUNT = 2;

interface TesseractWordLike {
  text: string | null;
  confidence: number | null;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

interface ColumnCropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface RefinedColumnsResult {
  columns: OcrColumn[];
  confidence: number | null;
}

class OcrEngine {
  private workers: Worker[] = [];
  private maxWorkers: number;
  private isPaused = false;
  private isRunning = false;
  private initialized = false;
  private initializing = false;
  private queue: number[] = [];
  private activePages = new Set<number>();
  private callbacks: OcrEngineCallbacks | null = null;

  constructor() {
    this.maxWorkers = Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, 4));
    console.log(`[OCR Engine] Max workers: ${this.maxWorkers}`);
  }

  async initialize() {
    if (this.initialized || this.initializing) return;
    this.initializing = true;
    
    console.log('[OCR Engine] Initializing workers...');
    
    try {
      // Create workers one at a time to avoid overwhelming the browser
      for (let i = 0; i < this.maxWorkers; i++) {
        console.log(`[OCR Engine] Creating worker ${i + 1}/${this.maxWorkers}...`);
        const worker = await createWorker('eng');
        this.workers.push(worker);
        console.log(`[OCR Engine] Worker ${i + 1} ready`);
      }
      this.initialized = true;
      console.log('[OCR Engine] All workers initialized');
    } catch (err) {
      console.error('[OCR Engine] Failed to initialize workers:', err);
      // Clean up any workers that were created
      for (const w of this.workers) {
        try { await w.terminate(); } catch { /* ignore cleanup errors */ }
      }
      this.workers = [];
      this.initializing = false;
      throw err;
    }
    
    this.initializing = false;
  }

  async processPages(
    pageNumbers: number[],
    callbacks: OcrEngineCallbacks
  ) {
    this.callbacks = callbacks;
    this.queue = [...pageNumbers];
    this.isRunning = true;
    this.isPaused = false;

    try {
      if (!this.initialized) {
        await this.initialize();
      }
    } catch (err) {
      console.error('[OCR Engine] Cannot start - initialization failed:', err);
      // Mark all pages as failed
      for (const pn of pageNumbers) {
        callbacks.onPageError(pn, 'OCR engine failed to initialize. Please retry.');
      }
      this.isRunning = false;
      callbacks.onComplete();
      return;
    }

    // Process with worker pool
    const workerPromises = this.workers.map((worker, idx) => 
      this.workerLoop(worker, idx)
    );

    await Promise.all(workerPromises);
    
    if (this.isRunning) {
      this.isRunning = false;
      callbacks.onComplete();
    }
  }

  private async workerLoop(worker: Worker, workerIndex: number) {
    while (this.isRunning) {
      while (this.isPaused && this.isRunning) {
        await new Promise(r => setTimeout(r, 200));
      }
      if (!this.isRunning) break;

      const pageNumber = this.queue.shift();
      if (pageNumber === undefined) break;

      this.activePages.add(pageNumber);
      this.callbacks?.onPageStart(pageNumber);
      console.log(`[OCR Engine] Worker ${workerIndex}: processing page ${pageNumber}`);

      try {
        // Step 1: Try native PDF.js text extraction first (instant)
        this.callbacks?.onPageProgress(pageNumber, 5);
        try {
          const nativeResult = await extractTextFromPage(pageNumber);
          const nativeText = cleanOcrText(nativeResult.text);

          if (nativeText.length >= MIN_TEXT_LENGTH) {
            console.log(`[OCR Engine] Worker ${workerIndex}: page ${pageNumber} extracted natively (${nativeText.length} chars)`);
            this.callbacks?.onPageProgress(pageNumber, 100);
            this.callbacks?.onPageComplete(pageNumber, {
              text: nativeText,
              confidence: 95,
              columns: normalizeColumns(nativeResult.columns),
            });
            continue;
          }
          console.log(`[OCR Engine] Worker ${workerIndex}: page ${pageNumber} native text too short (${nativeText.length} chars), falling back to OCR`);
        } catch (e) {
          console.log(`[OCR Engine] Worker ${workerIndex}: page ${pageNumber} native extraction failed, falling back to OCR`);
        }

        // Step 2: Render page to image with timeout
        this.callbacks?.onPageProgress(pageNumber, 10);
        const imageData = await this.withTimeout(
          renderPageForOcr(pageNumber),
          PAGE_TIMEOUT_MS,
          `Page ${pageNumber} rendering timed out`
        );

        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d')!;
        ctx.putImageData(imageData, 0, 0);

        this.callbacks?.onPageProgress(pageNumber, 30);

        // Step 3: Run OCR with timeout
        const result = await this.withTimeout(
          worker.recognize(canvas),
          PAGE_TIMEOUT_MS,
          `Page ${pageNumber} OCR timed out`
        );

        const initialLayout = buildColumnLayout(
          mapTesseractWordsToTokens(result.data.words ?? [])
        );

        this.callbacks?.onPageProgress(pageNumber, initialLayout.columns.length >= COLUMN_RERUN_MIN_COUNT ? 50 : 90);

        const refined = await this.refineColumnsWithColumnOcr(
          worker,
          canvas,
          initialLayout.columns,
          pageNumber
        );
        canvas.remove();

        const columns = normalizeColumns(
          refined.columns.length > 0 ? refined.columns : initialLayout.columns
        );
        const text = cleanOcrText(
          columns.map((column) => column.text).filter(Boolean).join('\n\n') ||
          initialLayout.text ||
          result.data.text
        );
        const confidence = refined.confidence ?? Math.round(result.data.confidence);

        console.log(`[OCR Engine] Worker ${workerIndex}: page ${pageNumber} done, confidence: ${confidence}`);
        this.callbacks?.onPageProgress(pageNumber, 100);
        this.callbacks?.onPageComplete(pageNumber, {
          text,
          confidence,
          columns,
        });
      } catch (err) {
        console.error(`[OCR Engine] Worker ${workerIndex}: page ${pageNumber} failed:`, err);
        const message = err instanceof Error ? err.message : 'Unknown OCR error';
        const isTimeout = message.includes('timed out');
        this.callbacks?.onPageError(
          pageNumber,
          isTimeout ? `Skipped: ${message}. This page may be image-heavy.` : message
        );
      } finally {
        this.activePages.delete(pageNumber);
      }
    }
  }

  private async refineColumnsWithColumnOcr(
    worker: Worker,
    pageCanvas: HTMLCanvasElement,
    columns: OcrColumn[],
    pageNumber: number
  ): Promise<RefinedColumnsResult> {
    if (columns.length < COLUMN_RERUN_MIN_COUNT) {
      return {
        columns,
        confidence: null,
      };
    }

    const refinedColumns: OcrColumn[] = [];
    let weightedConfidence = 0;
    let totalWeight = 0;

    for (let index = 0; index < columns.length; index += 1) {
      await this.waitWhilePaused();
      if (!this.isRunning) break;

      const fallbackColumn = columns[index];
      const cropRect = getColumnCropRect(
        fallbackColumn,
        pageCanvas.width,
        pageCanvas.height
      );

      this.callbacks?.onPageProgress(
        pageNumber,
        55 + Math.round(((index + 1) / columns.length) * 40)
      );

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropRect.width;
      cropCanvas.height = cropRect.height;

      try {
        const ctx = cropCanvas.getContext('2d');
        if (!ctx) {
          refinedColumns.push(fallbackColumn);
          continue;
        }

        ctx.drawImage(
          pageCanvas,
          cropRect.left,
          cropRect.top,
          cropRect.width,
          cropRect.height,
          0,
          0,
          cropRect.width,
          cropRect.height
        );

        const result = await this.withTimeout(
          worker.recognize(cropCanvas),
          COLUMN_TIMEOUT_MS,
          `Page ${pageNumber} column ${fallbackColumn.index} OCR timed out`
        );

        const rerunTokens = mapTesseractWordsToTokens(
          result.data.words ?? [],
          cropRect.left,
          cropRect.top
        );
        const rerunColumn = buildColumn(rerunTokens, fallbackColumn.index);

        if (rerunColumn && cleanOcrText(rerunColumn.text).length > 0) {
          refinedColumns.push(rerunColumn);
          const weight = Math.max(rerunColumn.tokens.length, 1);
          weightedConfidence += Math.round(result.data.confidence) * weight;
          totalWeight += weight;
        } else {
          refinedColumns.push(fallbackColumn);
        }
      } catch (err) {
        console.warn(
          `[OCR Engine] Page ${pageNumber} column ${fallbackColumn.index} rerun failed, keeping coarse layout`,
          err
        );
        refinedColumns.push(fallbackColumn);
      } finally {
        cropCanvas.remove();
      }
    }

    return {
      columns: refinedColumns.length === columns.length ? refinedColumns : columns,
      confidence: totalWeight > 0 ? Math.round(weightedConfidence / totalWeight) : null,
    };
  }

  private async waitWhilePaused() {
    while (this.isPaused && this.isRunning) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(message)), ms)
      ),
    ]);
  }

  pause() {
    this.isPaused = true;
  }

  resume() {
    this.isPaused = false;
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.queue = [];
  }

  retryPages(pageNumbers: number[]) {
    this.queue.push(...pageNumbers);
  }

  async terminate() {
    this.stop();
    for (const worker of this.workers) {
      try { await worker.terminate(); } catch { /* ignore cleanup errors */ }
    }
    this.workers = [];
    this.initialized = false;
    this.initializing = false;
  }

  get running() { return this.isRunning; }
  get paused() { return this.isPaused; }
  get queueLength() { return this.queue.length; }
  get activeCount() { return this.activePages.size; }
}

function normalizeColumns(columns: OcrColumn[]): OcrColumn[] {
  return columns.map((column) => ({
    ...column,
    text: cleanOcrText(column.text),
    tokens: column.tokens.map((token: OcrToken) => ({
      ...token,
      text: token.text.trim(),
    })),
  }));
}

function mapTesseractWordsToTokens(
  words: TesseractWordLike[],
  offsetX = 0,
  offsetY = 0
): OcrToken[] {
  return words
    .map((word): OcrToken | null => {
      if (!word.text?.trim()) {
        return null;
      }

      return {
        text: word.text,
        confidence: Math.round(word.confidence ?? 0),
        bbox: {
          x: word.bbox.x0 + offsetX,
          y: word.bbox.y0 + offsetY,
          width: Math.max(1, word.bbox.x1 - word.bbox.x0),
          height: Math.max(1, word.bbox.y1 - word.bbox.y0),
        },
      };
    })
    .filter((token): token is OcrToken => token !== null);
}

function getColumnCropRect(
  column: OcrColumn,
  canvasWidth: number,
  canvasHeight: number
): ColumnCropRect {
  const horizontalPadding = Math.max(24, Math.round(column.bbox.width * 0.08));
  const verticalPadding = Math.max(18, Math.round(column.bbox.height * 0.03));
  const left = clamp(Math.floor(column.bbox.x - horizontalPadding), 0, canvasWidth - 1);
  const top = clamp(Math.floor(column.bbox.y - verticalPadding), 0, canvasHeight - 1);
  const right = clamp(
    Math.ceil(column.bbox.x + column.bbox.width + horizontalPadding),
    left + 1,
    canvasWidth
  );
  const bottom = clamp(
    Math.ceil(column.bbox.y + column.bbox.height + verticalPadding),
    top + 1,
    canvasHeight
  );

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Singleton
export const ocrEngine = new OcrEngine();
