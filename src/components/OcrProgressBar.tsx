import { useOcrStore } from '@/stores/ocr-store';
import { motion } from 'framer-motion';
import { Activity, CheckCircle, AlertTriangle, Clock } from 'lucide-react';

export function OcrProgressBar() {
  const { currentProject, pages, isProcessing, isPaused } = useOcrStore();

  if (!currentProject) return null;

  const completed = pages.filter(p => p.status === 'completed').length;
  const failed = pages.filter(p => p.status === 'failed').length;
  const processing = pages.filter(p => p.status === 'processing').length;
  const total = pages.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="glass rounded-[1.5rem] border border-border/60 p-4 space-y-3 shadow-[0_16px_50px_-36px_rgba(15,23,42,0.38)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isProcessing && !isPaused ? (
            <Activity className="w-4 h-4 text-primary animate-pulse" />
          ) : isPaused ? (
            <Clock className="w-4 h-4 text-warning" />
          ) : completed === total ? (
            <CheckCircle className="w-4 h-4 text-success" />
          ) : (
            <Clock className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">
            {isProcessing && !isPaused
              ? 'Processing...'
              : isPaused
                ? 'Paused'
                : completed === total
                  ? 'Complete'
                  : 'Ready'}
          </span>
        </div>
        <span className="text-sm font-mono text-muted-foreground">
          {completed}/{total} pages
        </span>
      </div>

      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0 gradient-primary rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-success" />
          <span>{completed} done</span>
        </div>
        {processing > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
            <span>{processing} active</span>
          </div>
        )}
        {failed > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-destructive" />
            <span>{failed} failed</span>
          </div>
        )}
        {currentProject.averageConfidence > 0 && (
          <div className="flex items-center gap-1 ml-auto">
            <AlertTriangle className="w-3 h-3" />
            <span>Avg confidence: {currentProject.averageConfidence}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
