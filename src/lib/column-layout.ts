import type { OcrBoundingBox, OcrColumn, OcrLayoutRole, OcrToken } from '@/types/ocr';

interface ColumnLayoutResult {
  text: string;
  columns: OcrColumn[];
}

interface LayoutMetrics {
  averageHeight: number;
  averageWidth: number;
  medianHeight: number;
  verticalThreshold: number;
  horizontalThreshold: number;
}

/**
 * A horizontal band across the page where column structure is consistent.
 * Full-width headings occupy their own band; multi-column body is another.
 */
interface HorizontalBand {
  yStart: number;
  yEnd: number;
  lines: OcrToken[][];
}

/**
 * A vertical column region within a band (the actual spatial lane on the page).
 */
interface ColumnRegion {
  left: number;
  right: number;
  index: number;
}

/**
 * A reading group: contiguous block of tokens that should be read as a unit.
 */
interface ReadingGroup {
  tokens: OcrToken[];
  bbox: OcrBoundingBox;
  layoutRole: OcrLayoutRole;
  bandIndex: number;
  columnIndex: number;
}

const MIN_GUTTER_LINES_RATIO = 0.35;
const MIN_GUTTER_WIDTH_FACTOR = 1.5;
const HEADING_MAX_LINES = 2;
const HEADING_MAX_WORDS = 14;
const HEADING_MAX_WIDTH_RATIO = 0.75;

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildColumnLayout(tokens: OcrToken[]): ColumnLayoutResult {
  const normalizedTokens = tokens
    .map(normalizeToken)
    .filter((token): token is OcrToken => token !== null);

  if (normalizedTokens.length === 0) {
    return { text: '', columns: [] };
  }

  const metrics = computeLayoutMetrics(normalizedTokens);
  const lines = groupTokensIntoLines(normalizedTokens);
  const pageBounds = getBounds(normalizedTokens);

  // Step 1: Segment into horizontal bands (heading bands vs body bands)
  const bands = segmentIntoBands(lines, metrics, pageBounds);

  // Step 2: For each band, detect columns and assign tokens
  const readingGroups = extractReadingGroups(bands, metrics, pageBounds);

  // Step 3: Build OcrColumn per group, in reading order
  const columns = readingGroups
    .map((group, index) => buildColumn(group.tokens, index + 1, group.layoutRole))
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

function computeLayoutMetrics(tokens: OcrToken[]): LayoutMetrics {
  const heights = tokens.map((token) => token.bbox.height).sort((a, b) => a - b);
  const widths = tokens.map((token) => token.bbox.width).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const averageHeight = medianHeight;
  const averageWidth = widths[Math.floor(widths.length / 2)] ?? 24;

  return {
    averageHeight,
    averageWidth,
    medianHeight,
    verticalThreshold: Math.max(10, averageHeight * 1.5),
    horizontalThreshold: Math.max(24, averageWidth * MIN_GUTTER_WIDTH_FACTOR),
  };
}

// ─── Band Segmentation ───────────────────────────────────────────────────────

/**
 * Splits the page into horizontal bands. Lines that span the full width
 * (or nearly so) with few words are treated as heading bands; contiguous
 * non-heading lines form body bands.
 */
function segmentIntoBands(
  lines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): HorizontalBand[] {
  if (lines.length === 0) return [];

  const bands: HorizontalBand[] = [];
  let currentLines: OcrToken[][] = [];
  let currentIsHeading: boolean | null = null;

  for (const line of lines) {
    const isHeading = isHeadingLine(line, lines, metrics, pageBounds);

    if (currentIsHeading !== null && isHeading !== currentIsHeading) {
      // Flush the current band
      bands.push(makeBand(currentLines));
      currentLines = [];
    }

    currentLines.push(line);
    currentIsHeading = isHeading;
  }

  if (currentLines.length > 0) {
    bands.push(makeBand(currentLines));
  }

  return bands;
}

function makeBand(lines: OcrToken[][]): HorizontalBand {
  const allTokens = lines.flat();
  const bounds = getBounds(allTokens);
  return {
    yStart: bounds.y,
    yEnd: bounds.y + bounds.height,
    lines,
  };
}

/**
 * A line is considered a heading if it's short (few words), isolated vertically,
 * and roughly centered or significantly narrower than body content.
 */
function isHeadingLine(
  line: OcrToken[],
  allLines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): boolean {
  const bounds = getBounds(line);
  const wordCount = line.reduce((count, token) => {
    return count + token.text.split(/\s+/).filter(Boolean).length;
  }, 0);

  if (wordCount > HEADING_MAX_WORDS) return false;

  const widthRatio = bounds.width / Math.max(pageBounds.width, 1);
  if (widthRatio >= HEADING_MAX_WIDTH_RATIO) return false;

  // Check vertical gap from nearest line
  const lineBounds = getBounds(line);
  const centerY = lineBounds.y + lineBounds.height / 2;
  let minGap = Infinity;

  for (const otherLine of allLines) {
    if (otherLine === line) continue;
    const otherBounds = getBounds(otherLine);
    const gap = verticalGapBetween(lineBounds, otherBounds);
    minGap = Math.min(minGap, gap);
  }

  // Must have significant vertical gap to qualify as heading
  return minGap > metrics.verticalThreshold;
}

// ─── Column Detection via Projection ──────────────────────────────────────────

/**
 * Detects vertical column boundaries within a set of lines using gap analysis.
 * Returns the column regions if multi-column layout is detected.
 */
function detectColumnsInLines(
  lines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): ColumnRegion[] {
  if (lines.length < 2) return [];

  // Collect all inter-segment gaps across all lines
  const gutterCandidates = collectGutterCandidates(lines, metrics);
  if (gutterCandidates.length === 0) return [];

  // Cluster gutter candidates by their horizontal position
  const gutters = clusterGutters(gutterCandidates, metrics);

  // Filter to stable gutters that appear in enough lines
  const stableGutters = gutters.filter(
    (g) => g.lineCount / lines.length >= MIN_GUTTER_LINES_RATIO && g.lineCount >= 2
  );

  if (stableGutters.length === 0) return [];

  // Build column regions from the stable gutters
  return buildColumnRegions(stableGutters, pageBounds);
}

interface GutterCandidate {
  left: number;
  right: number;
  centerX: number;
}

interface GutterCluster {
  left: number;
  right: number;
  centerX: number;
  lineCount: number;
}

function collectGutterCandidates(
  lines: OcrToken[][],
  metrics: LayoutMetrics
): GutterCandidate[] {
  const candidates: GutterCandidate[] = [];

  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.bbox.x - b.bbox.x);
    if (sorted.length < 2) continue;

    // Walk through tokens looking for large horizontal gaps
    for (let i = 1; i < sorted.length; i++) {
      const prevRight = sorted[i - 1].bbox.x + sorted[i - 1].bbox.width;
      const currLeft = sorted[i].bbox.x;
      const gap = currLeft - prevRight;

      if (gap >= metrics.horizontalThreshold) {
        candidates.push({
          left: prevRight,
          right: currLeft,
          centerX: (prevRight + currLeft) / 2,
        });
      }
    }
  }

  return candidates;
}

function clusterGutters(
  candidates: GutterCandidate[],
  metrics: LayoutMetrics
): GutterCluster[] {
  if (candidates.length === 0) return [];

  const sorted = [...candidates].sort((a, b) => a.centerX - b.centerX);
  const clusters: GutterCluster[] = [];

  for (const candidate of sorted) {
    const matching = clusters.find(
      (c) => Math.abs(c.centerX - candidate.centerX) <= metrics.horizontalThreshold
    );

    if (matching) {
      // Weighted average to refine position
      const newCount = matching.lineCount + 1;
      matching.left =
        (matching.left * matching.lineCount + candidate.left) / newCount;
      matching.right =
        (matching.right * matching.lineCount + candidate.right) / newCount;
      matching.centerX =
        (matching.centerX * matching.lineCount + candidate.centerX) / newCount;
      matching.lineCount = newCount;
    } else {
      clusters.push({
        left: candidate.left,
        right: candidate.right,
        centerX: candidate.centerX,
        lineCount: 1,
      });
    }
  }

  return clusters;
}

function buildColumnRegions(
  gutters: GutterCluster[],
  pageBounds: OcrBoundingBox
): ColumnRegion[] {
  const sorted = [...gutters].sort((a, b) => a.centerX - b.centerX);
  const regions: ColumnRegion[] = [];
  let cursor = pageBounds.x;

  for (let i = 0; i < sorted.length; i++) {
    const gutter = sorted[i];
    if (gutter.left > cursor) {
      regions.push({
        left: cursor,
        right: gutter.left,
        index: regions.length,
      });
    }
    cursor = gutter.right;
  }

  // Last region (right of rightmost gutter)
  const pageRight = pageBounds.x + pageBounds.width;
  if (pageRight > cursor) {
    regions.push({
      left: cursor,
      right: pageRight,
      index: regions.length,
    });
  }

  return regions.length >= 2 ? regions : [];
}

// ─── Reading Group Extraction ─────────────────────────────────────────────────

/**
 * For each band, detect columns and produce reading groups.
 * Reading order: within each band, read each column fully top-to-bottom,
 * left-to-right.
 */
function extractReadingGroups(
  bands: HorizontalBand[],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): ReadingGroup[] {
  const groups: ReadingGroup[] = [];

  for (let bandIndex = 0; bandIndex < bands.length; bandIndex++) {
    const band = bands[bandIndex];
    const bandTokens = band.lines.flat();
    if (bandTokens.length === 0) continue;

    const bandBounds = getBounds(bandTokens);

    // Detect columns within this band
    const columnRegions = detectColumnsInLines(band.lines, metrics, pageBounds);

    if (columnRegions.length < 2) {
      // Single-column band (heading or single-column body)
      const isHeading =
        band.lines.length <= HEADING_MAX_LINES &&
        isHeadingLine(band.lines[0], bands.flatMap((b) => b.lines), metrics, pageBounds);

      groups.push({
        tokens: bandTokens,
        bbox: bandBounds,
        layoutRole: isHeading ? 'heading' : 'flow',
        bandIndex,
        columnIndex: 0,
      });
    } else {
      // Multi-column band: assign each token to its best-matching column
      const columnTokens: Map<number, OcrToken[]> = new Map();
      for (const region of columnRegions) {
        columnTokens.set(region.index, []);
      }

      for (const token of bandTokens) {
        const bestRegion = findBestColumnRegion(token, columnRegions);
        if (bestRegion !== null) {
          columnTokens.get(bestRegion.index)!.push(token);
        }
      }

      // Produce groups in column order (left to right), each read top-to-bottom
      for (const region of columnRegions) {
        const tokens = columnTokens.get(region.index) ?? [];
        if (tokens.length === 0) continue;

        groups.push({
          tokens,
          bbox: getBounds(tokens),
          layoutRole: 'side',
          bandIndex,
          columnIndex: region.index,
        });
      }
    }
  }

  return groups;
}

/**
 * Assigns a token to the column region it overlaps with the most.
 */
function findBestColumnRegion(
  token: OcrToken,
  regions: ColumnRegion[]
): ColumnRegion | null {
  let bestRegion: ColumnRegion | null = null;
  let bestOverlap = 0;

  for (const region of regions) {
    const overlap = overlapWidth(
      token.bbox,
      { x: region.left, y: 0, width: region.right - region.left, height: 1 }
    );
    const ratio = overlap / Math.max(token.bbox.width, 1);

    if (ratio > bestOverlap) {
      bestOverlap = ratio;
      bestRegion = region;
    }
  }

  return bestRegion;
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
  const lines = groupTokensIntoLines(tokens);

  return lines
    .map((line) => joinLine(line))
    .filter(Boolean)
    .join('\n');
}

function groupTokensIntoLines(tokens: OcrToken[]): OcrToken[][] {
  const sorted = sortTokens(tokens);
  if (sorted.length === 0) return [];

  const heights = sorted.map((token) => token.bbox.height).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const lineThreshold = Math.max(8, medianHeight * 0.6);
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

function overlapWidth(a: OcrBoundingBox, b: OcrBoundingBox): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
}
