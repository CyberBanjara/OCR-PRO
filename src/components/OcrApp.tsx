import { useState, useCallback, useEffect } from 'react';
import { useOcrStore } from '@/stores/ocr-store';
import { db } from '@/lib/db';
import { loadPdf, renderPageToDataUrl, destroyPdf } from '@/lib/pdf-renderer';
import { ocrEngine } from '@/lib/ocr-engine';
import { computeFileHash } from '@/lib/hash-utils';
import { FileUpload } from '@/components/FileUpload';
import { PdfViewer } from '@/components/PdfViewer';
import { PageThumbnail } from '@/components/PageThumbnail';
import { OcrProgressBar } from '@/components/OcrProgressBar';
import { OcrTextViewer } from '@/components/OcrTextViewer';
import { SearchPanel } from '@/components/SearchPanel';
import { ExportPanel } from '@/components/ExportPanel';
import { ProjectDashboard } from '@/components/ProjectDashboard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Play, Pause, Square, RotateCcw, ChevronLeft, ChevronRight, Home, Eye, Type } from 'lucide-react';
import type { OcrProject, OcrPage } from '@/types/ocr';
import { motion, AnimatePresence } from 'framer-motion';

type View = 'dashboard' | 'upload' | 'workspace';

export default function OcrApp() {
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(false);
  const [viewTab, setViewTab] = useState<string>('preview');
  const store = useOcrStore();

  // Load project from dashboard
  const openProject = useCallback(async (project: OcrProject) => {
    store.setCurrentProject(project);
    
    // Load pages from IndexedDB
    const pages = await db.pages.where('projectId').equals(project.id).toArray();
    store.setPages(
      pages
        .map((page) => ({ ...page, columns: page.columns ?? [] }))
        .sort((a, b) => a.pageNumber - b.pageNumber)
    );
    store.setCurrentPage(1);

    // Load PDF from IndexedDB
    const pdfFile = await db.pdfFiles.where('projectId').equals(project.id).first();
    if (pdfFile) {
      await loadPdf(pdfFile.data);
      setView('workspace');
    }
  }, [store]);

  // Handle new file upload
  const handleFileSelect = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const hash = await computeFileHash(arrayBuffer);
      // Clone before loadPdf, which transfers/detaches the original ArrayBuffer
      const arrayBufferForDb = arrayBuffer.slice(0);
      const pageCount = await loadPdf(arrayBuffer);
      
      const projectId = crypto.randomUUID();
      const project: OcrProject = {
        id: projectId,
        name: file.name.replace(/\.pdf$/i, ''),
        fileName: file.name,
        fileSize: file.size,
        pageCount,
        contentHash: hash,
        status: 'idle',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedPages: 0,
        averageConfidence: 0,
      };

      // Create page records
      const pages: OcrPage[] = Array.from({ length: pageCount }, (_, i) => ({
        id: `${projectId}_page_${i + 1}`,
        projectId,
        pageNumber: i + 1,
        status: 'pending' as const,
        text: '',
        columns: [],
        confidence: 0,
        processedAt: null,
        error: null,
        thumbnailDataUrl: null,
      }));

      // Generate thumbnails for first few pages
      for (let i = 0; i < Math.min(pageCount, 10); i++) {
        try {
          const thumb = await renderPageToDataUrl(i + 1);
          pages[i].thumbnailDataUrl = thumb;
        } catch { /* skip */ }
      }

      // Save to IndexedDB
      await db.projects.put(project);
      await db.pages.bulkPut(pages);
      await db.pdfFiles.put({ id: projectId, projectId, data: arrayBufferForDb });

      store.setCurrentProject(project);
      store.setPages(pages);
      store.setCurrentPage(1);
      setView('workspace');
    } catch (err) {
      console.error('Failed to load PDF:', err);
    } finally {
      setLoading(false);
    }
  }, [store]);

  // OCR controls
  const startOcr = useCallback(async () => {
    const { pages } = store;
    const pendingPages = pages
      .filter(p => p.status === 'pending' || p.status === 'failed')
      .map(p => p.pageNumber);

    if (pendingPages.length === 0) return;

    store.setProcessing(true);
    store.setPaused(false);

    await ocrEngine.processPages(pendingPages, {
      onPageStart: (pageNumber) => {
        store.updatePageStatus(pageNumber, 'processing');
      },
      onPageProgress: (pageNumber, progress) => {
        store.setPageProgress(pageNumber, progress);
      },
      onPageComplete: (pageNumber, result) => {
        store.updatePageStatus(pageNumber, 'completed', {
          text: result.text,
          confidence: result.confidence,
          processedAt: Date.now(),
          error: null,
        });
      },
      onPageError: (pageNumber, error) => {
        store.updatePageStatus(pageNumber, 'failed', { error });
      },
      onComplete: () => {
        store.setProcessing(false);
      },
    });
  }, [store]);

  const pauseOcr = () => {
    ocrEngine.pause();
    store.setPaused(true);
  };

  const resumeOcr = () => {
    ocrEngine.resume();
    store.setPaused(false);
  };

  const stopOcr = () => {
    ocrEngine.stop();
    store.setProcessing(false);
    store.setPaused(false);
  };

  const retryFailed = useCallback(() => {
    const failed = store.pages.filter(p => p.status === 'failed');
    failed.forEach(p => store.updatePageStatus(p.pageNumber, 'pending'));
    if (!store.isProcessing) {
      startOcr();
    } else {
      ocrEngine.retryPages(failed.map(p => p.pageNumber));
    }
  }, [store, startOcr]);

  const goHome = () => {
    destroyPdf();
    ocrEngine.stop();
    store.setCurrentProject(null);
    store.setPages([]);
    store.setProcessing(false);
    store.setPaused(false);
    setView('dashboard');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      destroyPdf();
      ocrEngine.terminate();
    };
  }, []);

  if (view === 'dashboard') {
    return (
      <div className="min-h-screen bg-background">
        <ProjectDashboard
          onOpenProject={openProject}
          onNewProject={() => setView('upload')}
        />
      </div>
    );
  }

  if (view === 'upload') {
    return (
      <div className="min-h-screen bg-background">
        <div className="p-4">
          <Button variant="ghost" size="sm" onClick={goHome} className="gap-1.5">
            <Home className="w-4 h-4" />
            <span>Projects</span>
          </Button>
        </div>
        <FileUpload onFileSelect={handleFileSelect} isLoading={loading} />
      </div>
    );
  }

  // Workspace view
  const { currentProject, pages, currentPageNumber, isProcessing, isPaused } = store;
  const currentPage = pages.find(p => p.pageNumber === currentPageNumber);
  const failedCount = pages.filter(p => p.status === 'failed').length;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="glass border-b border-border px-4 py-2.5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={goHome} className="gap-1.5">
            <Home className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="font-semibold text-sm">{currentProject?.name}</h2>
            <p className="text-xs text-muted-foreground">{currentProject?.pageCount} pages</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isProcessing ? (
            <Button size="sm" onClick={startOcr} className="gradient-primary text-primary-foreground gap-1.5 shadow-glow">
              <Play className="w-3.5 h-3.5" />
              Start OCR
            </Button>
          ) : (
            <>
              {isPaused ? (
                <Button size="sm" variant="outline" onClick={resumeOcr} className="gap-1.5">
                  <Play className="w-3.5 h-3.5" />
                  Resume
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={pauseOcr} className="gap-1.5">
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={stopOcr} className="gap-1.5">
                <Square className="w-3.5 h-3.5" />
                Stop
              </Button>
            </>
          )}
          {failedCount > 0 && (
            <Button size="sm" variant="outline" onClick={retryFailed} className="gap-1.5 text-destructive border-destructive/30">
              <RotateCcw className="w-3.5 h-3.5" />
              Retry {failedCount}
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Page sidebar */}
        <aside className="w-28 border-r border-border bg-card/30 overflow-y-auto p-2 flex flex-col gap-1 shrink-0">
          {pages.map(page => (
            <PageThumbnail
              key={page.id}
              pageNumber={page.pageNumber}
              thumbnailUrl={page.thumbnailDataUrl}
              status={page.status}
              confidence={page.confidence}
              isActive={page.pageNumber === currentPageNumber}
              onClick={() => store.setCurrentPage(page.pageNumber)}
            />
          ))}
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Progress */}
          <div className="px-4 pt-3">
            <OcrProgressBar />
          </div>

          {/* Page nav */}
          <div className="flex items-center justify-center gap-3 px-4 py-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={currentPageNumber <= 1}
              onClick={() => store.setCurrentPage(currentPageNumber - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-mono text-muted-foreground">
              {currentPageNumber} / {pages.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={currentPageNumber >= pages.length}
              onClick={() => store.setCurrentPage(currentPageNumber + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>

          {/* Tabs: Preview / Text */}
          <div className="flex-1 overflow-hidden px-4 pb-4">
            <Tabs value={viewTab} onValueChange={setViewTab} className="h-full flex flex-col">
              <TabsList className="mb-3 self-start">
                <TabsTrigger value="preview" className="gap-1.5 text-xs">
                  <Eye className="w-3.5 h-3.5" />
                  Preview
                </TabsTrigger>
                <TabsTrigger value="text" className="gap-1.5 text-xs">
                  <Type className="w-3.5 h-3.5" />
                  OCR Text
                </TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto">
                <TabsContent value="preview" className="mt-0">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentPageNumber}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <PdfViewer pageNumber={currentPageNumber} />
                    </motion.div>
                  </AnimatePresence>
                </TabsContent>
                <TabsContent value="text" className="mt-0">
                  <OcrTextViewer pageNumber={currentPageNumber} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </main>

        {/* Right sidebar */}
        <aside className="w-64 border-l border-border bg-card/30 overflow-y-auto p-4 space-y-6 shrink-0 hidden lg:block">
          <SearchPanel />
          <ExportPanel />
        </aside>
      </div>
    </div>
  );
}
