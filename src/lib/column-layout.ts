import type { OcrBoundingBox, OcrColumn, OcrLayoutRole, OcrToken } from '@/types/ocr';

interface ColumnLayoutResult {
  text: string;
  columns: OcrColumn[];
}

interface LayoutMetrics {
  averageHeight: number;
  averageWidth: number;
  medianHeight: number;
  pageWidth: number;
  pageHeight: number;
  /** Minimum absolute gap used as a baseline for splitting decisions */
  gutterThreshold: number;
  /** Typical inter-word spacing (30th percentile of observed gaps) */
  medianWordGap: number;
  /** Vertical distance to consider tokens on the same line */
  lineThreshold: number;
}

/**
 * A segment: a contiguous group of tokens within a single line, separated
 * from other segments on the same line by a significant horizontal gap.
 */
interface LineSegment {
  tokens: OcrToken[];
  leftX: number;
  rightX: number;
  topY: number;
  bottomY: number;
  centerY: number;
  lineIndex: number;
}

/**
 * A categorized spatial block: a cluster of segments that form a
 * visually distinct region on the page.
 */
interface SpatialBlock {
  tokens: OcrToken[];
  bbox: OcrBoundingBox;
  layoutRole: OcrLayoutRole;
}

// ─── Tuning Constants ─────────────────────────────────────────────────────────

/**
 * For splitting lines: a gap must be at least this many times the
 * per-line Q1 gap to be treated as a segment boundary.
 * 3.5x means "clearly much bigger than normal word spacing."
 */
const SPLIT_FACTOR = 3.5;

/** Heading constraints */
const HEADING_MAX_WORDS = 14;
const HEADING_MAX_WIDTH_RATIO = 0.75;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Main entry point. Breaks a page's tokens into spatial blocks by:
 *   1. Grouping tokens into text lines
 *   2. Splitting each line at significant horizontal gaps → segments
 *   3. Clustering nearby segments into spatial blocks (union-find)
 *   4. Assigning layout roles (heading / side / flow)
 *   5. Sorting blocks left-to-right, top-to-bottom
 *   6. Producing one OcrColumn per block
 */
export function buildColumnLayout(tokens: OcrToken[]): ColumnLayoutResult {
  const normalizedTokens = tokens
    .map(normalizeToken)
    .filter((token): token is OcrToken => token !== null);

  if (normalizedTokens.length === 0) {
    return { text: '', columns: [] };
  }

  const pageBounds = getBounds(normalizedTokens);
  const metrics = computeLayoutMetrics(normalizedTokens, pageBounds);
  const lines = groupTokensIntoLines(normalizedTokens, metrics);

  // Step 1: Split each line into segments at significant gaps
  const segments = splitLinesIntoSegments(lines, metrics);

  // Step 2: Cluster segments into spatial blocks
  const blocks = clusterSegmentsIntoBlocks(segments, metrics);

  // Step 3: Assign layout roles (heading, side, flow)
  const categorized = assignLayoutRoles(blocks, metrics, pageBounds);

  // Step 4: Sort blocks left-to-right, top-to-bottom
  const sortedBlocks = sortBlocks(categorized, metrics);

  // Debug logging
  if (typeof window !== 'undefined' && (window as any).__OCR_DEBUG__) {
    console.log('[ColumnLayout] tokens:', normalizedTokens.length,
      'lines:', lines.length,
      'segments:', segments.length,
      'blocks:', sortedBlocks.length,
      'pageW:', Math.round(pageBounds.width),
      'medianWordGap:', Math.round(metrics.medianWordGap),
      'roles:', sortedBlocks.map(b => b.layoutRole)
    );
  }

  // Step 5: Build OcrColumn per block
  const columns = sortedBlocks
    .map((block, index) => buildColumn(block.tokens, index + 1, block.layoutRole))
    .filter((column): column is OcrColumn => column !== null);

  return {
    text: columns
      .map((column) => column.text)
      .filter(Boolean)
      .join('\n\n'),
    columns,
  };
}

export function buildColumn(
  tokens: OcrToken[],
  index = 1,
  layoutRole: OcrLayoutRole = 'flow'
): OcrColumn | null {
  const normalizedTokens = tokens
    .map(normalizeToken)
    .filter((token): token is OcrToken => token !== null);

  if (normalizedTokens.length === 0) {
    return null;
  }

  const sortedTokens = sortTokens(normalizedTokens);

  return {
    index,
    bbox: getBounds(sortedTokens),
    text: tokensToText(sortedTokens),
    tokens: sortedTokens,
    layoutRole,
  };
}

// ─── Layout Metrics ───────────────────────────────────────────────────────────

/**
 * Computes adaptive layout metrics. The key metric is `medianWordGap`:
 * the typical inter-word spacing, used as the baseline for all gap-based
 * splitting decisions.
 */
function computeLayoutMetrics(tokens: OcrToken[], pageBounds: OcrBoundingBox): LayoutMetrics {
  const heights = tokens.map((token) => token.bbox.height).sort((a, b) => a - b);
  const widths = tokens.map((token) => token.bbox.width).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const averageHeight = medianHeight;
  const averageWidth = widths[Math.floor(widths.length / 2)] ?? 24;

  const pageWidth = Math.max(pageBounds.width, 1);
  const pageHeight = Math.max(pageBounds.height, 1);

  const medianWordGap = computeMedianWordGap(tokens, medianHeight);

  const gutterThreshold = Math.max(
    pageWidth * 0.02,
    medianWordGap * 2.5,
    6
  );

  return {
    averageHeight,
    averageWidth,
    medianHeight,
    pageWidth,
    pageHeight,
    gutterThreshold,
    medianWordGap,
    lineThreshold: Math.max(4, medianHeight * 0.6),
  };
}

/**
 * Computes the typical inter-word gap (30th percentile / Q1) to avoid
 * column gaps inflating the baseline.
 */
function computeMedianWordGap(tokens: OcrToken[], medianHeight: number): number {
  const sorted = [...tokens].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const gaps: number[] = [];
  const lineThreshold = Math.max(4, medianHeight * 0.6);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevCenterY = prev.bbox.y + prev.bbox.height / 2;
    const currCenterY = curr.bbox.y + curr.bbox.height / 2;

    if (Math.abs(prevCenterY - currCenterY) > lineThreshold) continue;

    const gap = curr.bbox.x - (prev.bbox.x + prev.bbox.width);
    if (gap > 0) {
      gaps.push(gap);
    }
  }

  if (gaps.length === 0) return 8;

  gaps.sort((a, b) => a - b);
  const q1Index = Math.floor(gaps.length * 0.3);
  return gaps[q1Index];
}

// ─── Step 1: Line Segment Splitting ───────────────────────────────────────────

/**
 * Splits each text line into segments at significant horizontal gaps.
 *
 * For lines with 3+ tokens (2+ gaps): uses the RELATIVE approach.
 * A gap is significant if it's >= SPLIT_FACTOR times the per-line Q1 gap
 * AND >= an absolute minimum.
 *
 * For lines with 2 tokens (1 gap): uses a conservative absolute threshold
 * to avoid splitting normal word pairs.
 *
 * For lines with 1 token: no splitting possible.
 */
function splitLinesIntoSegments(
  lines: OcrToken[][],
  metrics: LayoutMetrics
): LineSegment[] {
  const segments: LineSegment[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const sorted = [...line].sort((a, b) => a.bbox.x - b.bbox.x);
    if (sorted.length === 0) continue;

    if (sorted.length === 1) {
      // Single token → single segment
      segments.push(makeLineSegment(sorted, lineIdx));
      continue;
    }

    // Compute all inter-token gaps
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prevRight = sorted[i - 1].bbox.x + sorted[i - 1].bbox.width;
      const currLeft = sorted[i].bbox.x;
      gaps.push(Math.max(0, currLeft - prevRight));
    }

    // Determine split threshold
    let splitThreshold: number;

    if (gaps.length >= 2) {
      // Relative approach: compute per-line Q1 and apply factor
      const sortedGaps = [...gaps].sort((a, b) => a - b);
      const q1Idx = Math.floor(sortedGaps.length * 0.3);
      const q1Gap = Math.max(sortedGaps[q1Idx], 2);
      splitThreshold = Math.max(
        q1Gap * SPLIT_FACTOR,
        metrics.medianWordGap * 2,
        metrics.medianHeight,
        10
      );
    } else {
      // Only 1 gap (2 tokens): use conservative absolute threshold
      splitThreshold = Math.max(
        metrics.medianWordGap * 4,
        metrics.pageWidth * 0.08,
        20
      );
    }

    // Split line at gaps exceeding threshold
    let segStart = 0;
    for (let i = 0; i < gaps.length; i++) {
      if (gaps[i] >= splitThreshold) {
        const segTokens = sorted.slice(segStart, i + 1);
        if (segTokens.length > 0) {
          segments.push(makeLineSegment(segTokens, lineIdx));
        }
        segStart = i + 1;
      }
    }

    // Last segment
    const lastTokens = sorted.slice(segStart);
    if (lastTokens.length > 0) {
      segments.push(makeLineSegment(lastTokens, lineIdx));
    }
  }

  return segments;
}

function makeLineSegment(tokens: OcrToken[], lineIndex: number): LineSegment {
  const bounds = getBounds(tokens);
  return {
    tokens,
    leftX: bounds.x,
    rightX: bounds.x + bounds.width,
    topY: bounds.y,
    bottomY: bounds.y + bounds.height,
    centerY: bounds.y + bounds.height / 2,
    lineIndex,
  };
}

// ─── Step 2: Segment Clustering ───────────────────────────────────────────────

/**
 * Clusters segments into spatial blocks using union-find.
 *
 * Two segments in DIFFERENT lines are merged into the same block if:
 *   1. They are vertically close (within 4x median line height)
 *   2. Their horizontal extents overlap by at least 20%
 *
 * Segments on the SAME line are never merged (they were deliberately split).
 */
function clusterSegmentsIntoBlocks(
  segments: LineSegment[],
  metrics: LayoutMetrics
): OcrToken[][] {
  if (segments.length === 0) return [];

  // Union-Find with path compression
  const parent = segments.map((_, i) => i);

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(x: number, y: number): void {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  }

  const maxVertDist = metrics.medianHeight * 4;

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];

      // Never merge segments from the same line
      if (a.lineIndex === b.lineIndex) continue;

      // Must be vertically close
      const vertDist = Math.abs(a.centerY - b.centerY);
      if (vertDist > maxVertDist) continue;

      // Must overlap horizontally by at least 20%
      const overlapLeft = Math.max(a.leftX, b.leftX);
      const overlapRight = Math.min(a.rightX, b.rightX);
      const overlapWidth = Math.max(0, overlapRight - overlapLeft);

      const minSegWidth = Math.min(a.rightX - a.leftX, b.rightX - b.leftX);
      if (minSegWidth > 0 && overlapWidth >= minSegWidth * 0.20) {
        union(i, j);
      }
    }
  }

  // Collect blocks
  const blockMap = new Map<number, OcrToken[]>();
  for (let i = 0; i < segments.length; i++) {
    const root = find(i);
    if (!blockMap.has(root)) blockMap.set(root, []);
    blockMap.get(root)!.push(...segments[i].tokens);
  }

  return [...blockMap.values()];
}

// ─── Step 3: Layout Role Assignment ───────────────────────────────────────────

/**
 * Assigns layout roles to each block:
 *   • 'heading' — small, isolated blocks (few words, vertically separated)
 *   • 'side'    — blocks that share their Y range with another block
 *   • 'flow'    — everything else (single-column body text)
 */
function assignLayoutRoles(
  blocks: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): SpatialBlock[] {
  const categorized: SpatialBlock[] = blocks.map((tokens) => ({
    tokens,
    bbox: getBounds(tokens),
    layoutRole: 'flow' as OcrLayoutRole,
  }));

  // Detect headings
  for (const block of categorized) {
    const wordCount = block.tokens.reduce((count, token) => {
      return count + token.text.split(/\s+/).filter(Boolean).length;
    }, 0);

    if (wordCount > HEADING_MAX_WORDS) continue;

    const widthRatio = block.bbox.width / Math.max(pageBounds.width, 1);
    if (widthRatio >= HEADING_MAX_WIDTH_RATIO) continue;

    // Check vertical isolation
    let minGap = Infinity;
    for (const other of categorized) {
      if (other === block) continue;
      minGap = Math.min(minGap, verticalGapBetween(block.bbox, other.bbox));
    }

    if (minGap > metrics.medianHeight * 1.5) {
      block.layoutRole = 'heading';
    }
  }

  // Detect side columns: blocks that share Y range with another non-heading block
  for (const block of categorized) {
    if (block.layoutRole === 'heading') continue;

    const hasSibling = categorized.some((other) => {
      if (other === block || other.layoutRole === 'heading') return false;
      // Check vertical overlap
      const overlapTop = Math.max(block.bbox.y, other.bbox.y);
      const overlapBottom = Math.min(
        block.bbox.y + block.bbox.height,
        other.bbox.y + other.bbox.height
      );
      return overlapBottom > overlapTop;
    });

    if (hasSibling) {
      block.layoutRole = 'side';
    }
  }

  return categorized;
}

// ─── Step 4: Block Sorting ────────────────────────────────────────────────────

/**
 * Sorts blocks in reading order:
 *   - Top-to-bottom (by row)
 *   - Left-to-right within each row
 *
 * Two blocks are in the same "row" if their top Y positions are within
 * 3x the median line height.
 */
function sortBlocks(blocks: SpatialBlock[], metrics: LayoutMetrics): SpatialBlock[] {
  return [...blocks].sort((a, b) => {
    const yDiff = a.bbox.y - b.bbox.y;
    // If blocks are far apart vertically, sort by Y
    if (Math.abs(yDiff) > metrics.medianHeight * 3) return yDiff;
    // Same row: sort left-to-right
    return a.bbox.x - b.bbox.x;
  });
}

// ─── Token Processing ─────────────────────────────────────────────────────────

function normalizeToken(token: OcrToken): OcrToken | null {
  const text = token.text.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  return {
    ...token,
    text,
    bbox: {
      x: Math.max(0, token.bbox.x),
      y: Math.max(0, token.bbox.y),
      width: Math.max(1, token.bbox.width),
      height: Math.max(1, token.bbox.height),
    },
  };
}

function sortTokens(tokens: OcrToken[]): OcrToken[] {
  return [...tokens].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
}

// ─── Text Assembly ────────────────────────────────────────────────────────────

function tokensToText(tokens: OcrToken[]): string {
  const pageBounds = getBounds(tokens);
  const metrics = computeLayoutMetrics(tokens, pageBounds);
  const lines = groupTokensIntoLines(tokens, metrics);

  return lines
    .map((line) => joinLine(line))
    .filter(Boolean)
    .join('\n');
}

function groupTokensIntoLines(tokens: OcrToken[], metrics?: LayoutMetrics): OcrToken[][] {
  const sorted = sortTokens(tokens);
  if (sorted.length === 0) return [];

  const heights = sorted.map((token) => token.bbox.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const lineThreshold = metrics?.lineThreshold ?? Math.max(4, medianHeight * 0.6);
  const lines: Array<{ centerY: number; tokens: OcrToken[] }> = [];

  for (const token of sorted) {
    const centerY = token.bbox.y + token.bbox.height / 2;
    const lastLine = lines[lines.length - 1];

    if (!lastLine || Math.abs(centerY - lastLine.centerY) > lineThreshold) {
      lines.push({ centerY, tokens: [token] });
      continue;
    }

    lastLine.tokens.push(token);
    lastLine.centerY =
      (lastLine.centerY * (lastLine.tokens.length - 1) + centerY) / lastLine.tokens.length;
  }

  return lines.map((line) => [...line.tokens].sort((a, b) => a.bbox.x - b.bbox.x));
}

function joinLine(tokens: OcrToken[]): string {
  return tokens.reduce((line, token, index) => {
    if (index === 0) return token.text;
    if (/^[,.;:!?%)\]}]+$/.test(token.text)) return line + token.text;
    if (/^['"]/.test(token.text) && /[A-Za-z0-9]$/.test(line)) return line + token.text;
    if (line.endsWith('(') || line.endsWith('[') || line.endsWith('{')) return line + token.text;
    return `${line} ${token.text}`;
  }, '');
}

// ─── Geometry Utilities ───────────────────────────────────────────────────────

function getBounds(tokens: OcrToken[]): OcrBoundingBox {
  const minX = Math.min(...tokens.map((token) => token.bbox.x));
  const minY = Math.min(...tokens.map((token) => token.bbox.y));
  const maxX = Math.max(...tokens.map((token) => token.bbox.x + token.bbox.width));
  const maxY = Math.max(...tokens.map((token) => token.bbox.y + token.bbox.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function verticalGapBetween(a: OcrBoundingBox, b: OcrBoundingBox): number {
  if (a.y <= b.y) {
    return Math.max(0, b.y - (a.y + a.height));
  }

  return Math.max(0, a.y - (b.y + b.height));
}
