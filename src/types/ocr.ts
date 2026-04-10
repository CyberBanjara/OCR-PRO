export type PageStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ProjectStatus = 'idle' | 'processing' | 'paused' | 'completed';
export type ExportFormat = 'txt' | 'json' | 'pdf';
export type OcrLayoutRole = 'column' | 'heading' | 'side' | 'flow';

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrToken {
  text: string;
  confidence: number;
  bbox: OcrBoundingBox;
}

export interface OcrColumn {
  index: number;
  bbox: OcrBoundingBox;
  text: string;
  tokens: OcrToken[];
  layoutRole?: OcrLayoutRole;
}

export interface OcrProject {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
  pageCount: number;
  contentHash: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
  completedPages: number;
  averageConfidence: number;
}

export interface OcrPage {
  id: string;
  projectId: string;
  pageNumber: number;
  status: PageStatus;
  text: string;
  columns: OcrColumn[];
  confidence: number;
  processedAt: number | null;
  error: string | null;
  thumbnailDataUrl: string | null;
}

export interface OcrWorkerMessage {
  type: 'start' | 'progress' | 'result' | 'error';
  pageNumber: number;
  projectId: string;
  text?: string;
  confidence?: number;
  progress?: number;
  error?: string;
}

export interface ProjectStats {
  totalPages: number;
  completedPages: number;
  failedPages: number;
  pendingPages: number;
  processingPages: number;
  averageConfidence: number;
  totalWords: number;
}
