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

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "relative flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all border",
        isActive 
          ? "border-primary bg-primary/5 shadow-glow" 
          : "border-transparent hover:border-border hover:bg-card/50"
      )}
    >
      <div className="relative w-16 h-20 rounded-md overflow-hidden bg-muted flex items-center justify-center">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={`Page ${pageNumber}`} className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground">{pageNumber}</span>
        )}

        {/* Status overlay */}
        {status === 'processing' && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
            <span className="text-xs font-bold text-destructive">!</span>
          </div>
        )}
        {status === 'completed' && (
          <div className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-success" />
        )}
      </div>

      <span className="text-xs text-muted-foreground font-mono">{pageNumber}</span>

      {status === 'completed' && (
        <span className={cn(
          "text-[10px] font-mono font-medium",
          confidence >= 80 ? "text-success" : confidence >= 60 ? "text-warning" : "text-destructive"
        )}>
          {confidence}%
        </span>
      )}

      {status === 'processing' && progress > 0 && (
        <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-muted rounded-full overflow-hidden">
          <div className="h-full gradient-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
    </motion.button>
  );
}
