import { useEffect, useState } from 'react';
import { db } from '@/lib/db';
import type { OcrProject } from '@/types/ocr';
import { motion } from 'framer-motion';
import { FileText, Clock, BarChart3, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ProjectDashboardProps {
  onOpenProject: (project: OcrProject) => void;
  onNewProject: () => void;
}

export function ProjectDashboard({ onOpenProject, onNewProject }: ProjectDashboardProps) {
  const [projects, setProjects] = useState<OcrProject[]>([]);

  useEffect(() => {
    db.projects.orderBy('updatedAt').reverse().toArray().then(setProjects);
  }, []);

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await db.projects.delete(id);
    await db.pages.where('projectId').equals(id).delete();
    await db.pdfFiles.where('projectId').equals(id).delete();
    setProjects(prev => prev.filter(p => p.id !== id));
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold font-display gradient-text">Projects</h1>
          <p className="text-muted-foreground mt-1">Your OCR projects, stored locally.</p>
        </div>
        <Button onClick={onNewProject} className="gradient-primary gap-2 text-primary-foreground shadow-glow">
          <Plus className="w-4 h-4" />
          New Project
        </Button>
      </div>

      {projects.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20"
        >
          <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground">No projects yet. Upload a PDF to get started.</p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project, i) => (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => onOpenProject(project)}
              className="glass rounded-xl p-5 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate">{project.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{project.fileName}</p>
                </div>
                <button
                  onClick={(e) => deleteProject(project.id, e)}
                  className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <FileText className="w-3 h-3" />
                  <span>{project.pageCount} pages</span>
                </div>
                <div className="flex items-center gap-1">
                  <BarChart3 className="w-3 h-3" />
                  <span>{project.completedPages}/{project.pageCount} done</span>
                </div>
                {project.averageConfidence > 0 && (
                  <span className={cn(
                    "font-mono",
                    project.averageConfidence >= 80 ? "text-success" : "text-warning"
                  )}>
                    {project.averageConfidence}%
                  </span>
                )}
                <div className="flex items-center gap-1 ml-auto">
                  <Clock className="w-3 h-3" />
                  <span>{formatTime(project.updatedAt)}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-1 bg-muted rounded-full mt-3 overflow-hidden">
                <div
                  className="h-full gradient-primary rounded-full transition-all"
                  style={{ width: `${(project.completedPages / project.pageCount) * 100}%` }}
                />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}
