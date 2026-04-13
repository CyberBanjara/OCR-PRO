import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useOcrStore } from '@/stores/ocr-store';
import { cn } from '@/lib/utils';

interface PageThumbnailProps {
  pageNumber: number;
  thumbnailUrl: string | null;
  status: string;
  confidence: number;
  isActive: boolean;
  onClick: () => void;
}

export function PageThumbnail({ pageNumber, thumbnailUrl, status, confidence, isActive, onClick }: PageThumbnailProps) {
  const progress = useOcrStore(s => s.processingProgress.get(pageNumber) ?? 0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll active thumbnail into view
  useEffect(() => {
    if (isActive && buttonRef.current) {
      buttonRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  return (
    <motion.button
      ref={buttonRef}
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "relative flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all border-2",
        isActive 
          ? "border-primary bg-primary/10 shadow-glow ring-1 ring-primary/30" 
          : "border-transparent hover:border-border hover:bg-card/50"
      )}
    >
      <div className="relative w-full aspect-[3/4] rounded-md overflow-hidden bg-muted flex items-center justify-center">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`Page ${pageNumber}`} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground">{pageNumber}</span>
        )}

        {/* Status overlay */}
        {status === 'processing' && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
            <span className="text-xs font-bold text-destructive">!</span>
          </div>
        )}
        {status === 'completed' && (
          <div className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-success ring-2 ring-success/30" />
        )}
      </div>

      {/* Page number + confidence row */}
      <div className="flex items-center justify-between w-full px-0.5">
        <span className="text-[11px] text-muted-foreground font-mono">{pageNumber}</span>

        {status === 'completed' && (
          <span className={cn(
            "text-[10px] font-mono font-semibold",
            confidence >= 80 ? "text-success" : confidence >= 60 ? "text-warning" : "text-destructive"
          )}>
            {confidence}%
          </span>
        )}
      </div>

      {status === 'processing' && progress > 0 && (
        <div className="absolute bottom-0 left-1.5 right-1.5 h-0.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full gradient-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </motion.button>
  );
}
