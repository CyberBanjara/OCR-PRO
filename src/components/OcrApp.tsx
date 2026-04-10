import { useState, useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
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
import { Play, Pause, Square, RotateCcw, ChevronLeft, ChevronRight, Home, Eye, Type, ZoomIn, ZoomOut, Volume2, SkipBack, SkipForward } from 'lucide-react';
import type { OcrColumn, OcrProject, OcrPage } from '@/types/ocr';
import { motion, AnimatePresence } from 'framer-motion';

type View = 'dashboard' | 'upload' | 'workspace';
const PREVIEW_SCALE_MIN = 0.8;
const PREVIEW_SCALE_MAX = 2.4;
const PREVIEW_SCALE_STEP = 0.2;
const SIDEBAR_WIDTH_MIN = 88;
const SIDEBAR_WIDTH_MAX = 240;
const PUNCTUATION_PAUSE_MS = 2000;
const DEFAULT_PAUSE_MS = 250;

interface SpeechChunk {
  text: string;
  pauseAfter: number;
  voiceMode: 'body' | 'heading';
}

export default function OcrApp() {
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(false);
  const [viewTab, setViewTab] = useState<string>('preview');
  const [previewScale, setPreviewScale] = useState(1.5);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(112);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isAudioPaused, setIsAudioPaused] = useState(false);
  const [audioPageNumber, setAudioPageNumber] = useState<number | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<OcrPage[]>([]);
  const currentPageNumberRef = useRef(1);
  const speechRef = useRef<SpeechSynthesis | null>(null);
  const bodyVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const headingVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const narrationRunRef = useRef(0);
  const chunkTimeoutRef = useRef<number | null>(null);
  const pendingContinuationRef = useRef<(() => void) | null>(null);
  const store = useOcrStore();

  useEffect(() => {
    pagesRef.current = store.pages;
    currentPageNumberRef.current = store.currentPageNumber;
  }, [store.pages, store.currentPageNumber]);

  useEffect(() => {
    speechRef.current = typeof window !== 'undefined' ? window.speechSynthesis : null;
    const speech = speechRef.current;
    if (!speech) return;

    const assignVoice = () => {
      const voices = speech.getVoices();
      if (voices.length === 0) return;

      const primary = voices.find((voice) => voice.default)
        ?? voices.find((voice) => voice.lang?.toLowerCase().startsWith(navigator.language.toLowerCase().slice(0, 2)))
        ?? voices[0]
        ?? null;

      const alternate = voices.find((voice) =>
        primary &&
        voice.voiceURI !== primary.voiceURI &&
        voice.lang?.slice(0, 2).toLowerCase() === primary.lang?.slice(0, 2).toLowerCase()
      ) ?? voices.find((voice) => primary && voice.voiceURI !== primary.voiceURI) ?? primary;

      bodyVoiceRef.current = primary;
      headingVoiceRef.current = alternate;
    };

    assignVoice();
    speech.addEventListener('voiceschanged', assignVoice);
    return () => speech.removeEventListener('voiceschanged', assignVoice);
  }, []);

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
          columns: result.columns,
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

  const findPlayablePage = useCallback((startPageNumber: number, direction: 1 | -1) => {
    const source = direction === 1 ? pagesRef.current : [...pagesRef.current].reverse();
    return source.find((page) => (
      (direction === 1 ? page.pageNumber >= startPageNumber : page.pageNumber <= startPageNumber) &&
      page.status === 'completed' &&
      page.text.trim().length > 0
    )) ?? null;
  }, []);

  const stopAudio = useCallback(() => {
    narrationRunRef.current += 1;
    if (chunkTimeoutRef.current !== null) {
      window.clearTimeout(chunkTimeoutRef.current);
      chunkTimeoutRef.current = null;
    }
    pendingContinuationRef.current = null;
    speechRef.current?.cancel();
    setIsAudioPlaying(false);
    setIsAudioPaused(false);
    setAudioPageNumber(null);
  }, []);

  const speakPage = useCallback((page: OcrPage, runId: number) => {
    const speech = speechRef.current;
    if (!speech) return;
    const chunks = buildSpeechChunks(page);
    if (chunks.length === 0) {
      const nextPage = findPlayablePage(page.pageNumber + 1, 1);
      if (!nextPage) {
        stopAudio();
        return;
      }
      speakPage(nextPage, runId);
      return;
    }

    const speakChunk = (chunkIndex: number) => {
      if (runId !== narrationRunRef.current) return;

      if (chunkIndex >= chunks.length) {
        const nextPage = findPlayablePage(page.pageNumber + 1, 1);
        if (!nextPage) {
          stopAudio();
          return;
        }
        speakPage(nextPage, runId);
        return;
      }

      const chunk = chunks[chunkIndex];
      const speakWithVoice = (useExplicitVoice: boolean) => {
        const utterance = new SpeechSynthesisUtterance(chunk.text);
        const selectedVoice = chunk.voiceMode === 'heading'
          ? (headingVoiceRef.current ?? bodyVoiceRef.current)
          : bodyVoiceRef.current;

        if (useExplicitVoice && selectedVoice) {
          utterance.voice = selectedVoice;
          utterance.lang = selectedVoice.lang;
        }
        utterance.rate = chunk.voiceMode === 'heading' ? 0.92 : 1;
        utterance.pitch = chunk.voiceMode === 'heading' ? 1.15 : 1;
        utterance.onstart = () => {
          if (runId !== narrationRunRef.current) return;
          setIsAudioPlaying(true);
          setIsAudioPaused(false);
          setAudioPageNumber(page.pageNumber);
          store.setCurrentPage(page.pageNumber);
        };
        utterance.onend = () => {
          if (runId !== narrationRunRef.current) return;
          const continuePlayback = () => {
            pendingContinuationRef.current = null;
            chunkTimeoutRef.current = null;
            speakChunk(chunkIndex + 1);
          };

          if (chunk.pauseAfter > 0) {
            pendingContinuationRef.current = continuePlayback;
            chunkTimeoutRef.current = window.setTimeout(continuePlayback, chunk.pauseAfter);
            return;
          }

          continuePlayback();
        };
        utterance.onerror = () => {
          if (runId !== narrationRunRef.current) return;
          if (useExplicitVoice && selectedVoice) {
            speakWithVoice(false);
            return;
          }
          stopAudio();
        };

        speech.speak(utterance);
      };

      speakWithVoice(true);
    };

    speakChunk(0);
  }, [findPlayablePage, stopAudio, store]);

  const startAudio = useCallback((pageNumber?: number) => {
    const speech = speechRef.current;
    if (!speech) return;

    if (pageNumber === undefined && pendingContinuationRef.current && isAudioPlaying) {
      const continuation = pendingContinuationRef.current;
      pendingContinuationRef.current = null;
      if (chunkTimeoutRef.current !== null) {
        window.clearTimeout(chunkTimeoutRef.current);
        chunkTimeoutRef.current = null;
      }
      setIsAudioPaused(false);
      continuation();
      return;
    }

    if (pageNumber === undefined && speech.paused && isAudioPlaying) {
      speech.resume();
      setIsAudioPaused(false);
      return;
    }

    const targetStart = pageNumber ?? currentPageNumberRef.current;
    const page = findPlayablePage(targetStart, 1);
    if (!page) return;

    narrationRunRef.current += 1;
    const runId = narrationRunRef.current;

    if (chunkTimeoutRef.current !== null) {
      window.clearTimeout(chunkTimeoutRef.current);
      chunkTimeoutRef.current = null;
    }
    pendingContinuationRef.current = null;
    if (speech.speaking || speech.pending) {
      speech.cancel();
    }
    speech.resume();
    setIsAudioPlaying(true);
    setIsAudioPaused(false);
    setAudioPageNumber(page.pageNumber);
    store.setCurrentPage(page.pageNumber);
    speakPage(page, runId);
  }, [findPlayablePage, isAudioPlaying, speakPage, store]);

  const pauseAudio = useCallback(() => {
    const speech = speechRef.current;
    if (chunkTimeoutRef.current !== null && pendingContinuationRef.current) {
      window.clearTimeout(chunkTimeoutRef.current);
      chunkTimeoutRef.current = null;
      setIsAudioPaused(true);
      return;
    }
    if (!speech?.speaking) return;
    speech.pause();
    setIsAudioPaused(true);
  }, []);

  const skipAudioPage = useCallback((direction: 1 | -1) => {
    const basePage = audioPageNumber ?? currentPageNumberRef.current;
    const targetPage = findPlayablePage(basePage + direction, direction);
    if (!targetPage) return;
    startAudio(targetPage.pageNumber);
  }, [audioPageNumber, findPlayablePage, startAudio]);

  const goHome = () => {
    stopAudio();
    destroyPdf();
    ocrEngine.stop();
    store.setCurrentProject(null);
    store.setPages([]);
    store.setProcessing(false);
    store.setPaused(false);
    setView('dashboard');
  };

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const workspaceBounds = workspaceRef.current?.getBoundingClientRect();
    if (!workspaceBounds) return;

    event.preventDefault();

    const updateWidth = (clientX: number) => {
      const nextWidth = clientX - workspaceBounds.left;
      setLeftSidebarWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, nextWidth)));
    };

    updateWidth(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateWidth(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      destroyPdf();
      ocrEngine.terminate();
    };
  }, [stopAudio]);

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
  const previewZoom = Math.round((previewScale / 1.5) * 100);
  const audioReady = Boolean(currentPage && currentPage.status === 'completed' && currentPage.text.trim());

  return (
    <div className="h-[100dvh] overflow-hidden bg-background flex flex-col">
      {/* Header */}
      <header className="glass border-b border-border/70 px-4 py-3 flex items-center justify-between sticky top-0 z-50 backdrop-blur-2xl">
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

      <div ref={workspaceRef} className="flex flex-1 min-h-0 overflow-hidden">
        {/* Page sidebar */}
        <aside
          className="border-r border-border/70 bg-card/40 overflow-y-auto overscroll-contain p-2.5 flex flex-col gap-2 shrink-0"
          style={{ width: `${leftSidebarWidth}px` }}
        >
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

        <button
          type="button"
          aria-label="Resize page sidebar"
          onPointerDown={startSidebarResize}
          className="group relative hidden w-3 shrink-0 cursor-col-resize border-r border-border/50 bg-transparent lg:block"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-colors group-hover:bg-primary group-active:bg-primary" />
          <span className="absolute left-1/2 top-1/2 h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/80 transition-colors group-hover:bg-primary/70 group-active:bg-primary" />
        </button>

        {/* Main content */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-[linear-gradient(180deg,hsl(var(--background)),hsl(var(--surface-sunken)))]">
          {/* Progress */}
          <div className="px-4 pt-3">
            <OcrProgressBar />
          </div>

          {/* Page nav */}
          <div className="px-4 py-3">
            <div className="glass flex items-center justify-between rounded-2xl border border-border/60 px-3 py-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Review Page</p>
                <p className="text-sm font-medium text-foreground">
                  Page {currentPageNumber}
                  <span className="ml-1 text-muted-foreground">of {pages.length}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  disabled={currentPageNumber <= 1}
                  onClick={() => store.setCurrentPage(currentPageNumber - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-mono text-muted-foreground">
                  {currentPageNumber} / {pages.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  disabled={currentPageNumber >= pages.length}
                  onClick={() => store.setCurrentPage(currentPageNumber + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Tabs: Preview / Text */}
          <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4">
            <Tabs value={viewTab} onValueChange={setViewTab} className="h-full flex flex-col">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <TabsList className="self-start rounded-full bg-card/80 p-1 shadow-sm">
                  <TabsTrigger value="preview" className="gap-1.5 text-xs">
                    <Eye className="w-3.5 h-3.5" />
                    Preview
                  </TabsTrigger>
                  <TabsTrigger value="text" className="gap-1.5 text-xs">
                    <Type className="w-3.5 h-3.5" />
                    OCR Text
                  </TabsTrigger>
                </TabsList>

                {viewTab === 'preview' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="glass flex items-center gap-2 rounded-full border border-border/60 px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 rounded-full p-0"
                        disabled={!audioReady && audioPageNumber === null}
                        onClick={() => skipAudioPage(-1)}
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={!audioReady}
                        onClick={isAudioPlaying && !isAudioPaused ? pauseAudio : () => startAudio()}
                      >
                        {isAudioPlaying && !isAudioPaused ? <Pause className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                        {isAudioPlaying && !isAudioPaused ? 'Pause Audio' : isAudioPaused ? 'Resume Audio' : 'Play Audio'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 rounded-full p-0"
                        disabled={!audioReady && audioPageNumber === null}
                        onClick={() => skipAudioPage(1)}
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </Button>
                      {audioPageNumber && (
                        <span className="text-xs text-muted-foreground">
                          Page {audioPageNumber}
                        </span>
                      )}
                    </div>

                    <div className="glass flex items-center gap-2 rounded-full border border-border/60 px-2 py-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={previewScale <= PREVIEW_SCALE_MIN}
                        onClick={() => setPreviewScale((current) => Math.max(PREVIEW_SCALE_MIN, current - PREVIEW_SCALE_STEP))}
                      >
                        <ZoomOut className="w-3.5 h-3.5" />
                        Minimize
                      </Button>
                      <span className="min-w-14 text-center text-xs font-mono text-muted-foreground">
                        {previewZoom}%
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-full px-3 text-xs"
                        disabled={previewScale >= PREVIEW_SCALE_MAX}
                        onClick={() => setPreviewScale((current) => Math.min(PREVIEW_SCALE_MAX, current + PREVIEW_SCALE_STEP))}
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                        Maximize
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-hidden">
                <TabsContent value="preview" className="mt-0 h-full">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentPageNumber}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="h-full"
                    >
                      <PdfViewer pageNumber={currentPageNumber} scale={previewScale} />
                    </motion.div>
                  </AnimatePresence>
                </TabsContent>
                <TabsContent value="text" className="mt-0 h-full">
                  <OcrTextViewer pageNumber={currentPageNumber} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </main>

        {/* Right sidebar */}
        <aside className="w-72 border-l border-border/70 bg-card/40 overflow-y-auto overscroll-contain p-4 space-y-4 shrink-0 hidden lg:block">
          <SearchPanel />
          <ExportPanel />
        </aside>
      </div>
    </div>
  );
}

function buildSpeechChunks(page: OcrPage): SpeechChunk[] {
  const orderedColumns = page.columns.length > 0
    ? [...page.columns].sort((a, b) => a.index - b.index)
    : [];

  if (orderedColumns.length > 0) {
    const columnChunks = orderedColumns.flatMap((column) => columnToSpeechChunks(column));
    if (columnChunks.length > 0) {
      return columnChunks;
    }
  }

  return splitTextIntoSpeechChunks(page.text, 'body');
}

function columnToSpeechChunks(column: OcrColumn): SpeechChunk[] {
  const role = column.layoutRole === 'heading' ? 'heading' : 'body';
  return splitTextIntoSpeechChunks(column.text, role);
}

function splitTextIntoSpeechChunks(text: string, voiceMode: 'body' | 'heading'): SpeechChunk[] {
  return text
    .split(/(?<=[,.;:!?])\s+|\n+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => ({
      text: chunk,
      voiceMode,
      pauseAfter: /[,.!?;:]$/.test(chunk) ? PUNCTUATION_PAUSE_MS : DEFAULT_PAUSE_MS,
    }));
}
