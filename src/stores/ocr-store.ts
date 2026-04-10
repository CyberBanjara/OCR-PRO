import { create } from 'zustand';
import type { OcrProject, OcrPage, ProjectStatus, PageStatus } from '@/types/ocr';
import { db } from '@/lib/db';

interface OcrState {
  // Current project
  currentProjectId: string | null;
  currentProject: OcrProject | null;
  pages: OcrPage[];
  currentPageNumber: number;
  
  // OCR state
  isProcessing: boolean;
  isPaused: boolean;
  processingProgress: Map<number, number>;
  
  // Search
  searchQuery: string;
  searchResults: Array<{ pageNumber: number; matches: number }>;
  
  // Actions
  setCurrentProject: (project: OcrProject | null) => void;
  setPages: (pages: OcrPage[]) => void;
  setCurrentPage: (pageNumber: number) => void;
  updatePageStatus: (pageNumber: number, status: PageStatus, data?: Partial<OcrPage>) => void;
  setProcessing: (processing: boolean) => void;
  setPaused: (paused: boolean) => void;
  setPageProgress: (pageNumber: number, progress: number) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Array<{ pageNumber: number; matches: number }>) => void;
  updateProjectStats: () => void;
}

export const useOcrStore = create<OcrState>((set, get) => ({
  currentProjectId: null,
  currentProject: null,
  pages: [],
  currentPageNumber: 1,
  isProcessing: false,
  isPaused: false,
  processingProgress: new Map(),
  searchQuery: '',
  searchResults: [],

  setCurrentProject: (project) => set({ 
    currentProject: project, 
    currentProjectId: project?.id ?? null 
  }),

  setPages: (pages) => set({ pages }),

  setCurrentPage: (pageNumber) => set({ currentPageNumber: pageNumber }),

  updatePageStatus: (pageNumber, status, data) => {
    const { pages, currentProject } = get();
    const updated = pages.map(p => 
      p.pageNumber === pageNumber 
        ? { ...p, status, ...data }
        : p
    );
    set({ pages: updated });

    // Persist to IndexedDB
    const page = updated.find(p => p.pageNumber === pageNumber);
    if (page) {
      db.pages.put(page);
    }

    // Update project stats
    if (currentProject) {
      const completedPages = updated.filter(p => p.status === 'completed').length;
      const completedWithConfidence = updated.filter(p => p.status === 'completed' && p.confidence > 0);
      const avgConf = completedWithConfidence.length > 0
        ? completedWithConfidence.reduce((sum, p) => sum + p.confidence, 0) / completedWithConfidence.length
        : 0;
      
      const updatedProject = {
        ...currentProject,
        completedPages,
        averageConfidence: Math.round(avgConf),
        updatedAt: Date.now(),
        status: (completedPages === currentProject.pageCount ? 'completed' : currentProject.status) as ProjectStatus,
      };
      set({ currentProject: updatedProject });
      db.projects.put(updatedProject);
    }
  },

  setProcessing: (isProcessing) => set({ isProcessing }),
  setPaused: (isPaused) => set({ isPaused }),
  setPageProgress: (pageNumber, progress) => {
    const map = new Map(get().processingProgress);
    map.set(pageNumber, progress);
    set({ processingProgress: map });
  },
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchResults: (searchResults) => set({ searchResults }),
  updateProjectStats: () => {
    // Trigger re-render by updating pages reference
    set({ pages: [...get().pages] });
  },
}));
