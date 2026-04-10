# Local OCR Pro

Browser-based PDF OCR application built with React, TypeScript, PDF.js, Tesseract.js, Zustand, and IndexedDB. The app loads PDFs locally in the browser, extracts native text when available, falls back to OCR when needed, detects layout regions, stores project state offline, and exports OCR results as text, JSON, or print-friendly PDF.

## What the project does

- Upload a PDF and create a local OCR project
- Persist the PDF, page metadata, thumbnails, OCR text, and confidence scores in IndexedDB
- Prefer native PDF text extraction before running OCR
- Run OCR page-by-page with a browser worker pool
- Detect column/side/heading style layout regions from token bounding boxes
- Search OCR text inside the project workspace
- Export results as `.txt`, `.json`, or browser-printable PDF

## High-level architecture

### 1. UI layer

- [`src/main.tsx`](/home/sanskar/Documents/local-ocr-pro/src/main.tsx)
  Bootstraps the React application.
- [`src/App.tsx`](/home/sanskar/Documents/local-ocr-pro/src/App.tsx)
  Minimal router shell. Routes `/` to the OCR app and everything else to the not-found page.
- [`src/components/OcrApp.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/OcrApp.tsx)
  Main coordinator for the application. It owns the top-level view state:
  - `dashboard`
  - `upload`
  - `workspace`

### 2. State layer

- [`src/stores/ocr-store.ts`](/home/sanskar/Documents/local-ocr-pro/src/stores/ocr-store.ts)
  Zustand store for:
  - current project
  - page list
  - current page number
  - processing/pause state
  - per-page progress
  - search query and results

### 3. Persistence layer

- [`src/lib/db.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/db.ts)
  Dexie wrapper over IndexedDB.
  Stores three logical entities:
  - `projects`
  - `pages`
  - `pdfFiles`

### 4. PDF ingestion and rendering layer

- [`src/lib/pdf-renderer.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/pdf-renderer.ts)
  Uses `pdfjs-dist` to:
  - open PDFs
  - render page previews
  - render high-resolution OCR images
  - extract native text items with position data

### 5. OCR engine layer

- [`src/lib/ocr-engine.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/ocr-engine.ts)
  Uses `tesseract.js` with a worker pool to process pages concurrently.
  It contains:
  - worker initialization
  - page queue scheduling
  - native-text fallback logic
  - OCR timeouts
  - region re-OCR for better localized accuracy

### 6. Layout analysis layer

- [`src/lib/column-layout.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/column-layout.ts)
  Converts OCR/native text tokens into structured reading regions.
  The output region type is recorded as `layoutRole`:
  - `flow`
  - `column`
  - `side`
  - `heading`

### 7. Text normalization layer

- [`src/lib/text-cleanup.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/text-cleanup.ts)
  Cleans OCR/native text before display and export.

### 8. Export layer

- [`src/lib/export-utils.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/export-utils.ts)
  Generates exported OCR output.

## End-to-end processing flow

1. User uploads a PDF in [`src/components/FileUpload.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/FileUpload.tsx).
2. [`src/components/OcrApp.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/OcrApp.tsx) reads the file as `ArrayBuffer`.
3. [`src/lib/hash-utils.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/hash-utils.ts) computes a SHA-256 hash for file identity.
4. [`src/lib/pdf-renderer.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/pdf-renderer.ts) loads the PDF and returns page count.
5. Initial page records are created and stored in IndexedDB through [`src/lib/db.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/db.ts).
6. Thumbnail images are rendered for the first pages.
7. User starts OCR from the workspace.
8. [`src/lib/ocr-engine.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/ocr-engine.ts) processes pending pages:
   - native text extraction first
   - OCR fallback second
   - layout detection on extracted tokens
   - region-level rerun OCR when multiple regions are detected
9. Results are written back to:
   - Zustand store for live UI updates
   - IndexedDB for persistence
10. [`src/components/OcrTextViewer.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/OcrTextViewer.tsx) renders cleaned text as HTML.
11. [`src/components/ExportPanel.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ExportPanel.tsx) exports completed pages.

## OCR techniques used

### Native text extraction first

Where:
- [`src/lib/pdf-renderer.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/pdf-renderer.ts)
- [`src/lib/ocr-engine.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/ocr-engine.ts)

Why:
- Fastest path
- Highest fidelity for digital PDFs
- Avoids unnecessary OCR cost and OCR errors

How:
- `pdfjs-dist` returns text items with transform matrices
- Each text item is converted into an `OcrToken`
- Tokens are passed into layout detection immediately
- If cleaned native text length is above a minimum threshold, the engine accepts it and skips OCR

### Image-based OCR fallback

Where:
- [`src/lib/pdf-renderer.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/pdf-renderer.ts)
- [`src/lib/ocr-engine.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/ocr-engine.ts)

Why:
- Required for scanned/image-only PDFs
- Required when native extraction is too sparse or unavailable

How:
- Page is rendered at scale `2.5`
- Tesseract runs on the rendered page canvas
- Word-level boxes are converted into internal tokens

### Worker-pool parallel OCR

Where:
- [`src/lib/ocr-engine.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/ocr-engine.ts)

Why:
- Prevents serial OCR from becoming too slow
- Uses available browser CPU without overwhelming the tab

How:
- `maxWorkers = clamp(navigator.hardwareConcurrency - 1, 1, 4)`
- Workers pull pages from a shared queue
- Pause/resume/stop state is coordinated centrally

### Region-based re-OCR

Where:
- [`src/lib/ocr-engine.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/ocr-engine.ts)

Why:
- Whole-page OCR can mix columns/side strips
- Region reruns improve local recognition and reading order

How:
- After the first OCR pass, detected regions are cropped from the original page canvas
- Tesseract is rerun per region
- Confidence is recomputed as a weighted average of rerun region confidence

### Layout analysis from token geometry

Where:
- [`src/lib/column-layout.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/column-layout.ts)

Why:
- Raw OCR text order is often wrong
- Many pages contain columns, side regions, or headings that need structural recovery

Techniques used:

1. Token normalization
   - trims text
   - clamps bounding boxes to non-negative sizes

2. Adaptive thresholds
   - median token width and height are used to derive vertical and horizontal thresholds
   - this makes the detector scale with document typography

3. Line grouping
   - tokens are grouped into lines by vertical center proximity

4. Line segmentation by horizontal gaps
   - large x-gaps within a line split it into separate segments

5. Stable separator detection across the page
   - candidate x-gaps are aggregated across many rows
   - only gaps that are wide and persistent across a significant portion of the page are treated as structural separators
   - this is used to distinguish true content columns from one-off whitespace

6. Region band creation
   - the page is partitioned into persistent x-ranges between stable separators

7. Track assignment
   - line segments are assigned to the best region band when overlap is strong enough

8. Layout role classification
   - `heading`
   - `column`
   - `side`
   - `flow`

9. Reading-order reconstruction
   - final regions are sorted top-to-bottom, left-to-right
   - text for each region is built line-by-line

### OCR text cleanup and normalization

Where:
- [`src/lib/text-cleanup.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/text-cleanup.ts)

Why:
- OCR often returns symbol-font garbage, broken punctuation, repeated spaces, and formatting noise

Techniques used:
- decode private-use symbol-font characters back to ASCII
- normalize smart quotes and dashes
- remove invalid control characters
- normalize Unicode with `NFKD`
- collapse repeated whitespace
- remove dot leaders
- clean blank lines
- convert text into lightweight HTML paragraphs and headings for display

## UI/component architecture

### Main feature components

- [`src/components/ProjectDashboard.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ProjectDashboard.tsx)
  Lists saved OCR projects from IndexedDB.
- [`src/components/FileUpload.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/FileUpload.tsx)
  Handles drag-and-drop and file selection.
- [`src/components/PdfViewer.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/PdfViewer.tsx)
  Renders the current PDF page preview.
- [`src/components/PageThumbnail.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/PageThumbnail.tsx)
  Displays page thumbnails and selection state.
- [`src/components/OcrProgressBar.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/OcrProgressBar.tsx)
  Shows processing summary and animated progress.
- [`src/components/OcrTextViewer.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/OcrTextViewer.tsx)
  Displays cleaned OCR text and region outputs.
- [`src/components/SearchPanel.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/SearchPanel.tsx)
  Search UI over current OCR pages.
- [`src/components/ExportPanel.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ExportPanel.tsx)
  Starts export actions.

### Shared UI primitives still used

- [`src/components/ui/button.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ui/button.tsx)
- [`src/components/ui/input.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ui/input.tsx)
- [`src/components/ui/skeleton.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ui/skeleton.tsx)
- [`src/components/ui/tabs.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ui/tabs.tsx)

## Data model

Defined in [`src/types/ocr.ts`](/home/sanskar/Documents/local-ocr-pro/src/types/ocr.ts).

- `OcrProject`
  Project-level metadata and aggregate stats
- `OcrPage`
  Per-page processing state, text, confidence, and thumbnails
- `OcrToken`
  Word/token plus bounding box and confidence
- `OcrColumn`
  Logical text region with `layoutRole`
- `OcrLayoutRole`
  Structural classification used by the layout engine

## Package inventory

### Runtime dependencies

| Package | Where used | Why it is used |
| --- | --- | --- |
| `react` | Entire UI | Core component model |
| `react-dom` | [`src/main.tsx`](/home/sanskar/Documents/local-ocr-pro/src/main.tsx) | Browser rendering |
| `react-router-dom` | [`src/App.tsx`](/home/sanskar/Documents/local-ocr-pro/src/App.tsx), [`src/pages/NotFound.tsx`](/home/sanskar/Documents/local-ocr-pro/src/pages/NotFound.tsx) | Route handling |
| `zustand` | [`src/stores/ocr-store.ts`](/home/sanskar/Documents/local-ocr-pro/src/stores/ocr-store.ts) | Lightweight global state management |
| `dexie` | [`src/lib/db.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/db.ts) | Cleaner IndexedDB schema and queries |
| `pdfjs-dist` | [`src/lib/pdf-renderer.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/pdf-renderer.ts) | PDF loading, rendering, and native text extraction |
| `tesseract.js` | [`src/lib/ocr-engine.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/ocr-engine.ts) | OCR worker engine in the browser |
| `framer-motion` | [`src/components/OcrApp.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/OcrApp.tsx), dashboard/progress/thumbnail components | Motion and animated transitions |
| `lucide-react` | Multiple components | Icons |
| `@radix-ui/react-slot` | [`src/components/ui/button.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ui/button.tsx) | `asChild` composition pattern for buttons |
| `@radix-ui/react-tabs` | [`src/components/ui/tabs.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ui/tabs.tsx) | Accessible tabs in workspace view |
| `class-variance-authority` | [`src/components/ui/button.tsx`](/home/sanskar/Documents/local-ocr-pro/src/components/ui/button.tsx) | Button variant API |
| `clsx` | [`src/lib/utils.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/utils.ts) | Conditional class composition |
| `tailwind-merge` | [`src/lib/utils.ts`](/home/sanskar/Documents/local-ocr-pro/src/lib/utils.ts) | Deduplicate Tailwind classes |
| `tailwindcss-animate` | [`tailwind.config.ts`](/home/sanskar/Documents/local-ocr-pro/tailwind.config.ts) | Animation utilities for Tailwind |

### Development dependencies

| Package | Where used | Why it is used |
| --- | --- | --- |
| `vite` | [`vite.config.ts`](/home/sanskar/Documents/local-ocr-pro/vite.config.ts) | Dev server and build tool |
| `@vitejs/plugin-react-swc` | [`vite.config.ts`](/home/sanskar/Documents/local-ocr-pro/vite.config.ts), [`vitest.config.ts`](/home/sanskar/Documents/local-ocr-pro/vitest.config.ts) | Fast React + TypeScript transform |
| `typescript` | Whole repo | Static typing |
| `vitest` | [`vitest.config.ts`](/home/sanskar/Documents/local-ocr-pro/vitest.config.ts), test files | Unit testing |
| `jsdom` | [`vitest.config.ts`](/home/sanskar/Documents/local-ocr-pro/vitest.config.ts) | Browser-like test environment |
| `@testing-library/jest-dom` | [`src/test/setup.ts`](/home/sanskar/Documents/local-ocr-pro/src/test/setup.ts) | DOM matcher extensions for tests |
| `eslint` | [`eslint.config.js`](/home/sanskar/Documents/local-ocr-pro/eslint.config.js) | Linting |
| `@eslint/js` | [`eslint.config.js`](/home/sanskar/Documents/local-ocr-pro/eslint.config.js) | Base JS lint rules |
| `typescript-eslint` | [`eslint.config.js`](/home/sanskar/Documents/local-ocr-pro/eslint.config.js) | TypeScript-aware lint rules |
| `eslint-plugin-react-hooks` | [`eslint.config.js`](/home/sanskar/Documents/local-ocr-pro/eslint.config.js) | Hook correctness rules |
| `eslint-plugin-react-refresh` | [`eslint.config.js`](/home/sanskar/Documents/local-ocr-pro/eslint.config.js) | Fast-refresh export checks |
| `globals` | [`eslint.config.js`](/home/sanskar/Documents/local-ocr-pro/eslint.config.js) | Browser global definitions |
| `tailwindcss` | [`tailwind.config.ts`](/home/sanskar/Documents/local-ocr-pro/tailwind.config.ts) | Utility-first CSS engine |
| `postcss` | CSS build chain | CSS processing |
| `autoprefixer` | CSS build chain | Vendor prefix generation |
| `@types/node` | TypeScript config | Node typings for config files |
| `@types/react` | TypeScript config | React typings |
| `@types/react-dom` | TypeScript config | React DOM typings |

## Build and tooling

- [`vite.config.ts`](/home/sanskar/Documents/local-ocr-pro/vite.config.ts)
  - Vite dev server on port `8080`
  - path alias `@ -> ./src`
  - React dedupe configuration

- [`tailwind.config.ts`](/home/sanskar/Documents/local-ocr-pro/tailwind.config.ts)
  - theme tokens for colors, surface, shadows, radius, and fonts
  - animation extensions
  - `tailwindcss-animate` plugin

- [`vitest.config.ts`](/home/sanskar/Documents/local-ocr-pro/vitest.config.ts)
  - `jsdom` environment
  - React plugin
  - alias support

- [`eslint.config.js`](/home/sanskar/Documents/local-ocr-pro/eslint.config.js)
  - TypeScript linting
  - React hooks rules
  - React refresh rules

## Commands

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
```

## Notes on current design

- The project is fully client-side. OCR, rendering, persistence, and export all happen in the browser.
- IndexedDB is the source of truth for saved projects.
- The OCR engine is intentionally defensive:
  - worker initialization is guarded
  - page and region OCR both use timeouts
  - native text extraction is preferred whenever possible
- Layout analysis is heuristic, not ML-based document understanding. It relies on token geometry, line segmentation, persistent whitespace separators, and simple role classification.
