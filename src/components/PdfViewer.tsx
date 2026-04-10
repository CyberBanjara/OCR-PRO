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
    <div className="relative">
      {loading && (
        <Skeleton className="absolute inset-0 rounded-lg" />
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-auto rounded-lg shadow-md"
        style={{ display: loading ? 'none' : 'block' }}
      />
    </div>
  );
}
