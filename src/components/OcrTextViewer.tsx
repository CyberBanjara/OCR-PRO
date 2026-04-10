import { useOcrStore } from '@/stores/ocr-store';
import { useMemo, forwardRef } from 'react';
import { formatOcrTextAsHtml } from '@/lib/text-cleanup';

interface OcrTextViewerProps {
  pageNumber: number;
}

function applySearchHighlights(html: string, query: string): string {
  if (!query.trim()) return html;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark class="bg-primary/30 text-foreground rounded px-0.5">$1</mark>'
  );
}

export const OcrTextViewer = forwardRef<HTMLDivElement, OcrTextViewerProps>(function OcrTextViewer({ pageNumber }, ref) {
  const { pages, searchQuery } = useOcrStore();
  const page = pages.find(p => p.pageNumber === pageNumber);

  const formattedHtml = useMemo(() => {
    if (!page || !page.text) return '';
    return applySearchHighlights(formatOcrTextAsHtml(page.text), searchQuery);
  }, [page, searchQuery]);

  const formattedColumns = useMemo(() => {
    if (!page?.columns?.length) return [];

    return page.columns.map((column) => ({
      ...column,
      html: applySearchHighlights(formatOcrTextAsHtml(column.text), searchQuery),
    }));
  }, [page, searchQuery]);

  if (!page) return null;

  if (page.status === 'pending') {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        Waiting for OCR...
      </div>
    );
  }

  if (page.status === 'processing') {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-sm text-muted-foreground">Processing page {pageNumber}...</span>
        </div>
      </div>
    );
  }

  if (page.status === 'failed') {
    return (
      <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
        <p className="text-sm text-destructive font-medium">OCR Failed</p>
        <p className="text-xs text-destructive/80 mt-1">{page.error || 'Unknown error'}</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="ocr-panel h-full overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
        <span className="text-xs font-mono text-muted-foreground">
          Page {pageNumber} • Confidence: {page.confidence}%
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {page.columns.length > 1 && <span className="rounded-full bg-primary/8 px-2.5 py-1 text-primary">{page.columns.length} columns detected</span>}
          <span className="rounded-full bg-muted px-2.5 py-1">{page.text.split(/\s+/).filter(Boolean).length} words</span>
        </div>
      </div>

      {formattedColumns.length > 1 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {formattedColumns.map((column) => (
            <section
              key={column.index}
              className="rounded-[1.5rem] border border-border/70 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--surface-sunken)))] p-4 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.35)]"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs font-mono text-muted-foreground">
                  Column {column.index}
                </div>
                {column.layoutRole && (
                  <span className="rounded-full bg-background/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {column.layoutRole}
                  </span>
                )}
              </div>
              <div
                className="ocr-formatted-text text-sm leading-relaxed max-h-[52vh] overflow-y-auto overscroll-contain rounded-xl bg-background/60 p-4 selection:bg-primary/20"
                dangerouslySetInnerHTML={{ __html: column.html }}
              />
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-[1.5rem] border border-border/70 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--surface-sunken)))] p-4 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.35)]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Extracted Text</span>
            <span className="rounded-full bg-background/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Review Mode</span>
          </div>
          <div
            className="ocr-formatted-text text-sm leading-relaxed p-5 rounded-[1.25rem] bg-background/70 border border-border/60 max-h-[60vh] overflow-y-auto overscroll-contain selection:bg-primary/20"
            dangerouslySetInnerHTML={{ __html: formattedHtml }}
          />
        </div>
      )}
    </div>
  );
});
