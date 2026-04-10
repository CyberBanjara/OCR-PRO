import Dexie, { type EntityTable } from 'dexie';
import type { OcrProject, OcrPage } from '@/types/ocr';

interface PdfFile {
  id: string;
  projectId: string;
  data: ArrayBuffer;
}

const db = new Dexie('ocr-vault') as Dexie & {
  projects: EntityTable<OcrProject, 'id'>;
  pages: EntityTable<OcrPage, 'id'>;
  pdfFiles: EntityTable<PdfFile, 'id'>;
};

db.version(1).stores({
  projects: 'id, status, createdAt, updatedAt',
  pages: 'id, projectId, [projectId+pageNumber], status',
  pdfFiles: 'id, projectId',
});

export { db };
export type { PdfFile };
