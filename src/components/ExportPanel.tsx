import { useOcrStore } from '@/stores/ocr-store';
import { handleExport } from '@/lib/export-utils';
import { Button } from '@/components/ui/button';
import { FileText, FileJson, Printer } from 'lucide-react';
import type { ExportFormat } from '@/types/ocr';

export function ExportPanel() {
  const { currentProject, pages } = useOcrStore();

  if (!currentProject) return null;

  const completedCount = pages.filter(p => p.status === 'completed').length;
  if (completedCount === 0) return null;

  const doExport = (format: ExportFormat) => {
    handleExport(format, currentProject, pages);
  };

  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--surface-sunken)))] p-4 shadow-[0_18px_50px_-34px_rgba(15,23,42,0.3)]">
      <div className="mb-4">
        <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-[0.2em]">
          Export
        </p>
        <h3 className="mt-1 text-sm font-semibold">Download processed output</h3>
        <p className="mt-1 text-xs text-muted-foreground">{completedCount} completed pages ready</p>
      </div>
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="justify-start gap-2 h-9 rounded-xl bg-background/60" onClick={() => doExport('txt')}>
          <FileText className="w-3.5 h-3.5" />
          <span className="text-xs">Plain Text (.txt)</span>
        </Button>
        <Button variant="ghost" size="sm" className="justify-start gap-2 h-9 rounded-xl bg-background/60" onClick={() => doExport('json')}>
          <FileJson className="w-3.5 h-3.5" />
          <span className="text-xs">JSON (.json)</span>
        </Button>
        <Button variant="ghost" size="sm" className="justify-start gap-2 h-9 rounded-xl bg-background/60" onClick={() => doExport('pdf')}>
          <Printer className="w-3.5 h-3.5" />
          <span className="text-xs">Print / PDF</span>
        </Button>
      </div>
    </section>
  );
}
