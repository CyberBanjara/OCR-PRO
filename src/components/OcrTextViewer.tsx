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
    <div ref={ref} className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-muted-foreground">
          Page {pageNumber} • Confidence: {page.confidence}%
        </span>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {page.columns.length > 1 && <span>{page.columns.length} columns detected</span>}
          <span>{page.text.split(/\s+/).filter(Boolean).length} words</span>
        </div>
      </div>

      {formattedColumns.length > 1 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {formattedColumns.map((column) => (
            <section
              key={column.index}
              className="rounded-lg border border-border bg-surface-sunken p-4"
            >
              <div className="mb-3 text-xs font-mono text-muted-foreground">
                Column {column.index}
              </div>
              <div
                className="ocr-formatted-text text-sm leading-relaxed max-h-[52vh] overflow-y-auto selection:bg-primary/20"
                dangerouslySetInnerHTML={{ __html: column.html }}
              />
            </section>
          ))}
        </div>
      ) : (
        <div
          className="ocr-formatted-text text-sm leading-relaxed p-5 rounded-lg bg-surface-sunken border border-border max-h-[60vh] overflow-y-auto selection:bg-primary/20"
          dangerouslySetInnerHTML={{ __html: formattedHtml }}
        />
      )}
    </div>
  );
});
