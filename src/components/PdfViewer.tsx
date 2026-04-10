import { useEffect, useRef, useState, useMemo } from 'react';
import { renderPage } from '@/lib/pdf-renderer';
import { useOcrStore } from '@/stores/ocr-store';
import { Skeleton } from '@/components/ui/skeleton';
import type { OcrColumn } from '@/types/ocr';

interface PdfViewerProps {
  pageNumber: number;
  scale?: number;
}

/**
 * Distinct colors for each detected column overlay, with semi-transparent fill
 * and a solid border so columns are easy to distinguish visually.
 */
const COLUMN_COLORS = [
  { fill: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.7)' },   // Blue
  { fill: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.7)' },     // Red
  { fill: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.7)' },     // Green
  { fill: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.7)' },   // Purple
  { fill: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.7)' },   // Amber
  { fill: 'rgba(236, 72, 153, 0.12)', border: 'rgba(236, 72, 153, 0.7)' },   // Pink
];

export function PdfViewer({ pageNumber, scale = 1.5 }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  const { pages } = useOcrStore();
  const currentPage = pages.find(p => p.pageNumber === pageNumber);
  const columns = currentPage?.columns ?? [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setLoading(true);
    setError(null);

    renderPage(pageNumber, canvas, scale)
      .then(() => {
        setCanvasSize({ width: canvas.width, height: canvas.height });
        setLoading(false);
      })
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
    <div className="space-y-2">
      {/* Toggle button */}
      {columns.length > 1 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOverlay(!showOverlay)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
              transition-all duration-200 border
              ${showOverlay
                ? 'bg-primary/10 border-primary/30 text-primary shadow-sm'
                : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'}
            `}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="18" rx="1" />
              <rect x="14" y="3" width="7" height="18" rx="1" />
            </svg>
            {showOverlay ? 'Hide' : 'Show'} Column Boxes
            <span className="ml-1 opacity-60">({columns.length})</span>
          </button>

          {/* Column legend */}
          {showOverlay && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {columns.map((col, idx) => (
                <span key={col.index} className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded-sm border"
                    style={{
                      backgroundColor: COLUMN_COLORS[idx % COLUMN_COLORS.length].fill,
                      borderColor: COLUMN_COLORS[idx % COLUMN_COLORS.length].border,
                    }}
                  />
                  Col {col.index}
                  {col.layoutRole && col.layoutRole !== 'flow' && (
                    <span className="opacity-60">({col.layoutRole})</span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Page with overlay */}
      <div ref={containerRef} className="relative inline-block">
        {loading && (
          <Skeleton className="absolute inset-0 rounded-lg" />
        )}
        <canvas
          ref={canvasRef}
          className="w-full h-auto rounded-lg shadow-md"
          style={{ display: loading ? 'none' : 'block' }}
        />

        {/* Column overlay boxes */}
        {showOverlay && !loading && canvasSize && columns.length > 1 && (
          <ColumnOverlay
            columns={columns}
            canvasWidth={canvasSize.width}
            canvasHeight={canvasSize.height}
            renderScale={scale}
          />
        )}
      </div>
    </div>
  );
}

interface ColumnOverlayProps {
  columns: OcrColumn[];
  canvasWidth: number;
  canvasHeight: number;
  renderScale: number;
}

/**
 * Renders transparent colored boxes over each detected column.
 * The boxes are positioned as SVG overlays on top of the canvas,
 * mapped from token-space coordinates to display coordinates.
 */
function ColumnOverlay({ columns, canvasWidth, canvasHeight, renderScale }: ColumnOverlayProps) {
  // The canvas has intrinsic dimensions (canvasWidth x canvasHeight) but is
  // displayed via CSS `width: 100%`, so we need the aspect ratio to position
  // overlays correctly. We use viewBox to let SVG handle the scaling.
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
      style={{ borderRadius: 'inherit' }}
    >
      {columns.map((column, idx) => {
        const color = COLUMN_COLORS[idx % COLUMN_COLORS.length];
        // Column bbox is in the coordinate space of the *original* page.
        // The canvas renders at `renderScale`, so multiply bbox values by scale.
        const x = column.bbox.x * renderScale;
        const y = column.bbox.y * renderScale;
        const w = column.bbox.width * renderScale;
        const h = column.bbox.height * renderScale;

        return (
          <g key={column.index}>
            {/* Fill */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={color.fill}
              rx={4}
            />
            {/* Border */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={color.border}
              strokeWidth={2}
              strokeDasharray="6 3"
              rx={4}
            />
            {/* Label */}
            <rect
              x={x}
              y={y}
              width={Math.min(w, 90)}
              height={22}
              fill={color.border}
              rx={4}
            />
            <text
              x={x + 6}
              y={y + 15}
              fill="white"
              fontSize="12"
              fontWeight="600"
              fontFamily="system-ui, sans-serif"
            >
              Col {column.index}{column.layoutRole && column.layoutRole !== 'flow' ? ` (${column.layoutRole})` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
