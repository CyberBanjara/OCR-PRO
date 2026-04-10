import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Upload, FileText, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
}

export function FileUpload({ onFileSelect, isLoading }: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center min-h-[60vh] px-4"
    >
      <div className="text-center mb-8 max-w-lg">
        <h1 className="text-4xl font-bold font-display mb-3 gradient-text">
          OCR Vault
        </h1>
        <p className="text-muted-foreground text-lg">
          Privacy-first OCR. Your documents never leave your browser.
        </p>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          "relative flex flex-col items-center justify-center w-full max-w-xl h-64 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-300",
          isDragOver 
            ? "border-primary bg-primary/5 shadow-glow scale-[1.02]" 
            : "border-border hover:border-primary/50 hover:bg-card/50",
          isLoading && "pointer-events-none opacity-60"
        )}
      >
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isLoading}
        />
        
        <motion.div
          animate={isDragOver ? { scale: 1.1 } : { scale: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="p-4 rounded-2xl gradient-primary shadow-glow">
            <Upload className="w-8 h-8 text-primary-foreground" />
          </div>
          <div className="text-center">
            <p className="text-foreground font-medium text-lg">
              {isLoading ? 'Loading PDF...' : 'Drop a PDF here'}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              or click to browse
            </p>
          </div>
        </motion.div>
      </label>

      <div className="flex items-center gap-6 mt-8 text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" />
          <span>100% local processing</span>
        </div>
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-accent" />
          <span>PDF files supported</span>
        </div>
      </div>
    </motion.div>
  );
}
