import { useEffect, useRef } from 'react';
import { renderPage } from '@/lib/pdf-renderer';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';

interface PdfViewerProps {
  pageNumber: number;
  scale?: number;
}

export function PdfViewer({ pageNumber, scale = 1.5 }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setLoading(true);
    setError(null);

    renderPage(pageNumber, canvas, scale)
      .then(() => setLoading(false))
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [pageNumber, scale]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 rounded-lg bg-destructive/10 text-destructive text-sm">
        Failed to render page: {error}
      </div>
    );
  }

  return (
    <div className="ocr-panel relative h-full overflow-auto overscroll-contain p-4 sm:p-6">
      {loading && (
        <Skeleton className="absolute inset-4 rounded-[1.5rem] sm:inset-6" />
      )}
      <div className="flex min-h-full items-start justify-center">
        <canvas
          ref={canvasRef}
          className="h-auto max-w-full rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_28px_80px_-36px_rgba(15,23,42,0.45)]"
          style={{ display: loading ? 'none' : 'block' }}
        />
      </div>
    </div>
  );
}
