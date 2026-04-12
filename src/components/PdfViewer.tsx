import { useEffect, useRef, useState } from 'react';
import { renderPage } from '@/lib/pdf-renderer';
import { useOcrStore } from '@/stores/ocr-store';
import { Skeleton } from '@/components/ui/skeleton';
import type { OcrBoundingBox, OcrColumn } from '@/types/ocr';

interface PdfViewerProps {
  pageNumber: number;
  scale?: number;
}

/**
 * Distinct colors for each detected column overlay, with semi-transparent fill
 * and a solid border so columns are easy to distinguish visually.
 */
const COLUMN_COLORS = [
  { fill: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.8)' },   // Blue
  { fill: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.8)' },     // Red
  { fill: 'rgba(34, 197, 94, 0.15)', border: 'rgba(34, 197, 94, 0.8)' },     // Green
  { fill: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.8)' },   // Purple
  { fill: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.8)' },   // Amber
  { fill: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.8)' },   // Pink
];

/**
 * Post-processes scaled column bounding boxes so that no two boxes overlap.
 *
 * Strategy (left-to-right sweep):
 *   Sort columns by their left edge (x).
 *   For every pair (A, B) where A is to the left of B:
 *     - If they share vertical space AND A's right edge crosses B's left edge,
 *       trim A's right edge back to B's left edge (leaving a 3 px gutter).
 *
 * This converts the raw "tight token hull" bboxes (which can be as wide as a
 * full-width heading) into non-overlapping display rectangles.
 */
function computeNonOverlappingBboxes(
  columns: OcrColumn[],
  renderScale: number
): OcrBoundingBox[] {
  // Scale bboxes once; work on mutable copies
  const bboxes: OcrBoundingBox[] = columns.map((col) => ({
    x: col.bbox.x * renderScale,
    y: col.bbox.y * renderScale,
    width: col.bbox.width * renderScale,
    height: col.bbox.height * renderScale,
  }));

  // Build an index sorted by left edge so we only scan leftwards columns
  const byX = bboxes
    .map((_, i) => i)
    .sort((a, b) => bboxes[a].x - bboxes[b].x);

  const GUTTER = 3; // px gap to leave between adjacent columns

  for (let ai = 0; ai < byX.length; ai++) {
    const idxA = byX[ai];
    const a = bboxes[idxA];

    for (let bi = ai + 1; bi < byX.length; bi++) {
      const idxB = byX[bi];
      const b = bboxes[idxB];

      // If B starts at or beyond A's right edge there is no overlap – skip
      if (b.x >= a.x + a.width) continue;

      // Check vertical overlap (columns must share Y space to matter)
      const overlapTop = Math.max(a.y, b.y);
      const overlapBottom = Math.min(a.y + a.height, b.y + b.height);
      if (overlapBottom <= overlapTop) continue;

      // They DO overlap in both dimensions → trim A's right edge
      const newWidth = b.x - a.x - GUTTER;
      if (newWidth > 12) {
        // Only shrink if the result is still wide enough to be visible
        a.width = newWidth;
      }
    }
  }

  return bboxes;
}

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
 *
 * Critically, the raw bboxes from the OCR engine are "tight token hulls" and
 * can overlap each other (e.g. a full-width heading makes Col 1 cover the
 * entire page width, overlapping adjacent columns).
 *
 * We fix this with `computeNonOverlappingBboxes`: for every pair of columns
 * that share vertical space AND whose raw bboxes cross horizontally, we trim
 * the left column's right edge back to where the right column starts.  The
 * result is a set of non-overlapping display rectangles.
 */
function ColumnOverlay({ columns, canvasWidth, canvasHeight, renderScale }: ColumnOverlayProps) {
  // Compute display bboxes that never overlap each other
  const displayBboxes = computeNonOverlappingBboxes(columns, renderScale);

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
      style={{ borderRadius: 'inherit' }}
    >
      <defs>
        {/* One clip path per column, matching its (non-overlapping) display bbox */}
        {displayBboxes.map((bbox, idx) => (
          <clipPath key={`clip-${idx}`} id={`col-clip-${idx}`}>
            <rect
              x={bbox.x + 1}
              y={bbox.y + 1}
              width={Math.max(0, bbox.width - 2)}
              height={Math.max(0, bbox.height - 2)}
              rx={3}
            />
          </clipPath>
        ))}
      </defs>

      {columns.map((column, idx) => {
        const color = COLUMN_COLORS[idx % COLUMN_COLORS.length];
        const { x, y, width: w, height: h } = displayBboxes[idx];

        // Label text
        const label = `Col ${column.index}${
          column.layoutRole && column.layoutRole !== 'flow'
            ? ` (${column.layoutRole})`
            : ''
        }`;
        // Label badge width: fit within the column, minimum so text is legible
        const labelW = Math.max(44, Math.min(w - 4, 90));

        return (
          <g key={column.index} clipPath={`url(#col-clip-${idx})`}>
            {/* Semi-transparent fill */}
            <rect x={x} y={y} width={w} height={h} fill={color.fill} rx={4} />

            {/* Dashed border (inset by 1 px so it sits inside the clip) */}
            <rect
              x={x + 1}
              y={y + 1}
              width={Math.max(0, w - 2)}
              height={Math.max(0, h - 2)}
              fill="none"
              stroke={color.border}
              strokeWidth={2}
              strokeDasharray="6 3"
              rx={3}
            />

            {/* Label badge */}
            <rect
              x={x + 1}
              y={y + 1}
              width={labelW}
              height={22}
              fill={color.border}
              rx={3}
            />
            <text
              x={x + 7}
              y={y + 16}
              fill="white"
              fontSize="11"
              fontWeight="700"
              fontFamily="system-ui, sans-serif"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
