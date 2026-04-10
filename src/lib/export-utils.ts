import type { OcrPage, OcrProject, ExportFormat } from '@/types/ocr';

export function exportAsText(project: OcrProject, pages: OcrPage[]): string {
  const sorted = [...pages]
    .filter(p => p.status === 'completed')
    .sort((a, b) => a.pageNumber - b.pageNumber);

  let output = `# ${project.name}\n`;
  output += `# File: ${project.fileName}\n`;
  output += `# Pages: ${project.pageCount}\n`;
  output += `# Average Confidence: ${project.averageConfidence}%\n`;
  output += `# Exported: ${new Date().toISOString()}\n\n`;

  for (const page of sorted) {
    output += `--- Page ${page.pageNumber} (Confidence: ${page.confidence}%) ---\n\n`;
    output += page.text + '\n\n';
  }

  return output;
}

export function exportAsJson(project: OcrProject, pages: OcrPage[]): string {
  const sorted = [...pages]
    .filter(p => p.status === 'completed')
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const data = {
    project: {
      name: project.name,
      fileName: project.fileName,
      pageCount: project.pageCount,
      averageConfidence: project.averageConfidence,
      exportedAt: new Date().toISOString(),
    },
    pages: sorted.map(p => ({
      pageNumber: p.pageNumber,
      text: p.text,
      columns: p.columns.map(column => ({
        index: column.index,
        bbox: column.bbox,
        text: column.text,
        tokens: column.tokens,
      })),
      confidence: p.confidence,
      processedAt: p.processedAt ? new Date(p.processedAt).toISOString() : null,
    })),
  };

  return JSON.stringify(data, null, 2);
}

export function downloadFile(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function handleExport(format: ExportFormat, project: OcrProject, pages: OcrPage[]) {
  const baseName = project.fileName.replace(/\.pdf$/i, '');
  
  switch (format) {
    case 'txt': {
      const text = exportAsText(project, pages);
      downloadFile(text, `${baseName}_ocr.txt`, 'text/plain');
      break;
    }
    case 'json': {
      const json = exportAsJson(project, pages);
      downloadFile(json, `${baseName}_ocr.json`, 'application/json');
      break;
    }
    case 'pdf': {
      // For PDF export, we create a simple text-based HTML and print
      const text = exportAsText(project, pages);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html><head><title>${project.name}</title>
          <style>body{font-family:monospace;white-space:pre-wrap;padding:2rem;font-size:12px;line-height:1.6;}</style>
          </head><body>${text.replace(/</g, '&lt;')}</body></html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
      break;
    }
  }
}
