import { useOcrStore } from '@/stores/ocr-store';
import { handleExport } from '@/lib/export-utils';
import { Button } from '@/components/ui/button';
import { Download, FileText, FileJson, Printer } from 'lucide-react';
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
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
        Export ({completedCount} pages)
      </p>
      <div className="flex flex-col gap-1.5">
        <Button variant="ghost" size="sm" className="justify-start gap-2 h-8" onClick={() => doExport('txt')}>
          <FileText className="w-3.5 h-3.5" />
          <span className="text-xs">Plain Text (.txt)</span>
        </Button>
        <Button variant="ghost" size="sm" className="justify-start gap-2 h-8" onClick={() => doExport('json')}>
          <FileJson className="w-3.5 h-3.5" />
          <span className="text-xs">JSON (.json)</span>
        </Button>
        <Button variant="ghost" size="sm" className="justify-start gap-2 h-8" onClick={() => doExport('pdf')}>
          <Printer className="w-3.5 h-3.5" />
          <span className="text-xs">Print / PDF</span>
        </Button>
      </div>
    </div>
  );
}
