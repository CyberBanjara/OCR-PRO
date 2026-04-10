import { useState, useMemo } from 'react';
import { useOcrStore } from '@/stores/ocr-store';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function SearchPanel() {
  const { pages, searchQuery, setSearchQuery, setSearchResults, setCurrentPage } = useOcrStore();
  const [localQuery, setLocalQuery] = useState(searchQuery);

  const results = useMemo(() => {
    if (!localQuery.trim()) return [];
    const q = localQuery.toLowerCase();
    return pages
      .filter(p => p.status === 'completed' && p.text.toLowerCase().includes(q))
      .map(p => {
        const matches = (p.text.toLowerCase().match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
        return { pageNumber: p.pageNumber, matches, snippet: getSnippet(p.text, localQuery) };
      })
      .sort((a, b) => b.matches - a.matches);
  }, [localQuery, pages]);

  const handleSearch = (value: string) => {
    setLocalQuery(value);
    setSearchQuery(value);
    if (!value.trim()) {
      setSearchResults([]);
    } else {
      setSearchResults(results.map(r => ({ pageNumber: r.pageNumber, matches: r.matches })));
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={localQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search across all pages..."
          className="pl-9 pr-9 bg-card border-border"
        />
        {localQuery && (
          <button
            onClick={() => handleSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          <p className="text-xs text-muted-foreground px-1">
            {results.reduce((s, r) => s + r.matches, 0)} matches in {results.length} pages
          </p>
          {results.map((r) => (
            <button
              key={r.pageNumber}
              onClick={() => setCurrentPage(r.pageNumber)}
              className="w-full text-left px-3 py-2 rounded-lg hover:bg-card/80 transition-colors group"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Page {r.pageNumber}</span>
                <span className="text-xs text-muted-foreground font-mono">{r.matches} hits</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2"
                dangerouslySetInnerHTML={{ __html: r.snippet }}
              />
            </button>
          ))}
        </div>
      )}

      {localQuery && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No matches found</p>
      )}
    </div>
  );
}

function getSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 40);
  let snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  snippet = snippet.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '<mark class="bg-primary/30 text-foreground rounded px-0.5">$1</mark>'
  );
  return snippet;
}
