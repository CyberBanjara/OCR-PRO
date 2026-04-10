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
  /** Minimum absolute gap to consider as a gutter (conservative) */
  gutterThreshold: number;
  /** Median inter-word spacing computed from actual token gaps */
  medianWordGap: number;
  /** Vertical distance to consider tokens on the same line */
  lineThreshold: number;
}

/**
 * A horizontal band across the page where column structure is consistent.
 * Full-width headings occupy their own band; multi-column body is another.
 */
interface HorizontalBand {
  yStart: number;
  yEnd: number;
  lines: OcrToken[][];
  isHeading: boolean;
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

// ─── Tuning Constants ─────────────────────────────────────────────────────────

/** Fraction of lines that must show a gutter for it to be "stable" */
const MIN_GUTTER_LINES_RATIO = 0.20;
/** Gutter must appear in at least this many lines */
const MIN_GUTTER_LINE_COUNT = 2;
/** Heading constraints */
const HEADING_MAX_LINES = 2;
const HEADING_MAX_WORDS = 14;
const HEADING_MAX_WIDTH_RATIO = 0.75;
/**
 * For relative-gap detection: a gap must be at least this many times
 * larger than the median inter-word gap on the same line to be considered
 * a column boundary.
 */
const RELATIVE_GAP_FACTOR = 2.8;

// ─── Public API ───────────────────────────────────────────────────────────────

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

  // Step 1: Segment into horizontal bands (heading bands vs body bands)
  const bands = segmentIntoBands(lines, metrics, pageBounds);

  // Step 2: For each band, detect columns and assign tokens
  const readingGroups = extractReadingGroups(bands, metrics, pageBounds);

  if (typeof window !== 'undefined' && (window as any).__OCR_DEBUG__) {
    console.log('[ColumnLayout] tokens:', normalizedTokens.length,
      'lines:', lines.length,
      'bands:', bands.length,
      'groups:', readingGroups.length,
      'pageW:', Math.round(pageBounds.width),
      'gutterThresh:', Math.round(metrics.gutterThreshold),
      'medianWordGap:', Math.round(metrics.medianWordGap),
      'roles:', readingGroups.map(g => g.layoutRole)
    );
  }

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

/**
 * Computes adaptive layout metrics based on actual token dimensions,
 * the page coordinate space, AND observed inter-word spacing.
 *
 * The key insight: the gutter threshold should be based on actual
 * inter-word spacing (how far apart words are on the same line),
 * NOT on word width (how wide a single word is). These can be very
 * different — e.g. words might be 60px wide but only 4px apart.
 */
function computeLayoutMetrics(tokens: OcrToken[], pageBounds: OcrBoundingBox): LayoutMetrics {
  const heights = tokens.map((token) => token.bbox.height).sort((a, b) => a - b);
  const widths = tokens.map((token) => token.bbox.width).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const averageHeight = medianHeight;
  const averageWidth = widths[Math.floor(widths.length / 2)] ?? 24;

  const pageWidth = Math.max(pageBounds.width, 1);
  const pageHeight = Math.max(pageBounds.height, 1);

  // Compute actual median inter-word gap from the tokens
  const medianWordGap = computeMedianWordGap(tokens, medianHeight);

  // Gutter threshold: use the LARGER of:
  //   - 2% of page width (works at any scale)
  //   - 2.5x the median word gap (adaptive to actual spacing)
  //   - absolute minimum of 6px
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
 * Computes the typical inter-word gap between consecutive tokens on the
 * same line. Uses the 30th percentile (Q1) instead of median because in
 * a multi-column layout, ~50% of gaps might be column gaps. Using Q1
 * ensures we capture actual word spacing, not outlier column gaps.
 */
function computeMedianWordGap(tokens: OcrToken[], medianHeight: number): number {
  const sorted = [...tokens].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const gaps: number[] = [];
  const lineThreshold = Math.max(4, medianHeight * 0.6);

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    // Only consider tokens on the same line
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
  // Use 30th percentile to avoid column gaps inflating the baseline
  const q1Index = Math.floor(gaps.length * 0.3);
  return gaps[q1Index];
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
    const heading = isHeadingLine(line, lines, metrics, pageBounds);

    if (currentIsHeading !== null && heading !== currentIsHeading) {
      // Flush the current band
      bands.push(makeBand(currentLines, currentIsHeading));
      currentLines = [];
    }

    currentLines.push(line);
    currentIsHeading = heading;
  }

  if (currentLines.length > 0) {
    bands.push(makeBand(currentLines, currentIsHeading ?? false));
  }

  return bands;
}

function makeBand(lines: OcrToken[][], isHeading: boolean): HorizontalBand {
  const allTokens = lines.flat();
  const bounds = getBounds(allTokens);
  return {
    yStart: bounds.y,
    yEnd: bounds.y + bounds.height,
    lines,
    isHeading,
  };
}

/**
 * A line is considered a heading if it's short (few words), isolated vertically,
 * and significantly narrower than the page.
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
  let minGap = Infinity;

  for (const otherLine of allLines) {
    if (otherLine === line) continue;
    const otherBounds = getBounds(otherLine);
    const gap = verticalGapBetween(lineBounds, otherBounds);
    minGap = Math.min(minGap, gap);
  }

  // Must have significant vertical gap to qualify as heading
  return minGap > metrics.medianHeight * 1.5;
}

// ─── Column Detection ─────────────────────────────────────────────────────────

/**
 * Three-strategy column detection:
 *
 * Strategy 1 (absolute gap): Look for consistent horizontal gaps that
 * exceed the gutterThreshold. Works for wide, obvious column gutters.
 *
 * Strategy 2 (relative gap): For each line, compare the LARGEST gap to
 * the MEDIAN gap. If the largest gap is significantly bigger than normal
 * word spacing on that line, it's a column boundary. This is the key
 * strategy for textbook-style layouts where the gutter is narrow but
 * still clearly larger than word spacing.
 *
 * Strategy 3 (density histogram): Project token positions onto the X-axis
 * and find empty vertical bands. Catches cases where individual gaps are
 * small but there's still a clear empty strip.
 */
function detectColumnsInLines(
  lines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): ColumnRegion[] {
  if (lines.length < 2) return [];

  // Strategy 1: Absolute gap analysis (fast, catches wide gutters)
  const gapResult = detectColumnsViaGaps(lines, metrics, pageBounds);
  if (gapResult.length >= 2) return gapResult;

  // Strategy 2: Relative gap analysis (catches narrow gutters)
  const relativeResult = detectColumnsViaRelativeGaps(lines, metrics, pageBounds);
  if (relativeResult.length >= 2) return relativeResult;

  // Strategy 3: X-axis density histogram (catches fragmented tokens)
  const histogramResult = detectColumnsViaHistogram(lines, metrics, pageBounds);
  if (histogramResult.length >= 2) return histogramResult;

  return [];
}

// ─── Strategy 1: Absolute Gap Detection ───────────────────────────────────────

/**
 * Find gutters by looking for gaps wider than gutterThreshold on each line.
 */
function detectColumnsViaGaps(
  lines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): ColumnRegion[] {
  const gutterCandidates = collectGutterCandidates(lines, metrics.gutterThreshold);
  if (gutterCandidates.length === 0) return [];

  const gutters = clusterGutters(gutterCandidates, metrics);

  const stableGutters = gutters.filter(
    (g) =>
      g.lineCount / lines.length >= MIN_GUTTER_LINES_RATIO &&
      g.lineCount >= MIN_GUTTER_LINE_COUNT
  );

  if (stableGutters.length === 0) return [];

  return buildColumnRegions(stableGutters, pageBounds);
}

function collectGutterCandidates(
  lines: OcrToken[][],
  threshold: number
): GutterCandidate[] {
  const candidates: GutterCandidate[] = [];

  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.bbox.x - b.bbox.x);
    if (sorted.length < 2) continue;

    for (let i = 1; i < sorted.length; i++) {
      const prevRight = sorted[i - 1].bbox.x + sorted[i - 1].bbox.width;
      const currLeft = sorted[i].bbox.x;
      const gap = currLeft - prevRight;

      if (gap >= threshold) {
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

// ─── Strategy 2: Relative Gap Detection ───────────────────────────────────────

/**
 * For each line with 3+ tokens, compute all inter-token gaps. If the LARGEST
 * gap is significantly bigger (RELATIVE_GAP_FACTOR times) the MEDIAN gap,
 * that largest gap is a column boundary candidate.
 *
 * This is the key strategy for detecting columns in layouts like textbooks
 * where the gutter between columns might be quite narrow (e.g. 20-30px)
 * but is still clearly larger than the normal inter-word spacing (5-8px).
 *
 * By comparing gaps RELATIVE to each other rather than against an absolute
 * threshold, this approach works at any scale, resolution, or font size.
 */
function detectColumnsViaRelativeGaps(
  lines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): ColumnRegion[] {
  const candidates: GutterCandidate[] = [];

  for (const line of lines) {
    const sorted = [...line].sort((a, b) => a.bbox.x - b.bbox.x);
    if (sorted.length < 3) continue; // Need 2+ gaps to compare

    // Compute all inter-token gaps in this line
    const gaps: Array<{ gap: number; left: number; right: number }> = [];
    for (let i = 1; i < sorted.length; i++) {
      const prevRight = sorted[i - 1].bbox.x + sorted[i - 1].bbox.width;
      const currLeft = sorted[i].bbox.x;
      const gap = currLeft - prevRight;
      if (gap > 0) {
        gaps.push({ gap, left: prevRight, right: currLeft });
      }
    }

    if (gaps.length < 2) continue;

    // Find the median gap (typical word spacing for THIS line)
    const sortedGaps = gaps.map((g) => g.gap).sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

    if (medianGap <= 0) continue;

    // Find the largest gap and check if it's much bigger than the median
    const maxGapEntry = gaps.reduce(
      (best, entry) => (entry.gap > best.gap ? entry : best),
      gaps[0]
    );

    // The gap must be RELATIVE_GAP_FACTOR times the median AND have
    // a minimum absolute size (to avoid noise in very tight text)
    if (
      maxGapEntry.gap >= medianGap * RELATIVE_GAP_FACTOR &&
      maxGapEntry.gap >= Math.max(6, metrics.medianWordGap * 1.5)
    ) {
      candidates.push({
        left: maxGapEntry.left,
        right: maxGapEntry.right,
        centerX: (maxGapEntry.left + maxGapEntry.right) / 2,
      });
    }
  }

  if (candidates.length === 0) return [];

  // Cluster and validate
  const gutters = clusterGutters(candidates, metrics);

  const stableGutters = gutters.filter(
    (g) =>
      g.lineCount / lines.length >= MIN_GUTTER_LINES_RATIO &&
      g.lineCount >= MIN_GUTTER_LINE_COUNT
  );

  if (stableGutters.length === 0) return [];

  return buildColumnRegions(stableGutters, pageBounds);
}

// ─── Strategy 3: Histogram Detection ──────────────────────────────────────────

/**
 * Divide the X-axis into bins and count how many tokens cover each bin.
 * Empty or near-empty vertical strips that run through the page are gutters.
 */
function detectColumnsViaHistogram(
  lines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): ColumnRegion[] {
  const allTokens = lines.flat();
  // Histogram needs meaningful amounts of data to avoid false positives
  if (allTokens.length < 8 || lines.length < 3) return [];

  // Use fine bins for good resolution
  const binCount = Math.max(50, Math.min(300, Math.round(metrics.pageWidth / 2)));
  const binWidth = metrics.pageWidth / binCount;
  const bins = new Float32Array(binCount);

  for (const token of allTokens) {
    const tokenLeft = token.bbox.x - pageBounds.x;
    const tokenRight = tokenLeft + token.bbox.width;
    const startBin = Math.max(0, Math.floor(tokenLeft / binWidth));
    const endBin = Math.min(binCount - 1, Math.floor(tokenRight / binWidth));

    for (let b = startBin; b <= endBin; b++) {
      bins[b] += 1;
    }
  }

  let maxDensity = 0;
  for (let b = 0; b < binCount; b++) {
    maxDensity = Math.max(maxDensity, bins[b]);
  }

  if (maxDensity < 2) return [];

  // Look for empty/near-empty strips (density <= 5% of max),
  // in the middle 80% of the page (margins excluded)
  const marginBins = Math.floor(binCount * 0.1);
  const emptyThreshold = maxDensity * 0.05;

  // Minimum gutter width: just enough to not detect inter-character gaps
  // Use 1% of page width or 6px, whichever is larger
  const minGutterWidth = Math.max(6, metrics.pageWidth * 0.01);

  const emptyStrips: Array<{ startBin: number; endBin: number }> = [];
  let stripStart: number | null = null;

  for (let b = marginBins; b < binCount - marginBins; b++) {
    if (bins[b] <= emptyThreshold) {
      if (stripStart === null) stripStart = b;
    } else {
      if (stripStart !== null) {
        const stripWidth = (b - stripStart) * binWidth;
        if (stripWidth >= minGutterWidth) {
          emptyStrips.push({ startBin: stripStart, endBin: b - 1 });
        }
        stripStart = null;
      }
    }
  }

  if (stripStart !== null) {
    const endB = binCount - marginBins - 1;
    const stripWidth = (endB - stripStart + 1) * binWidth;
    if (stripWidth >= minGutterWidth) {
      emptyStrips.push({ startBin: stripStart, endBin: endB });
    }
  }

  if (emptyStrips.length === 0) return [];

  // Verify each empty strip has substantial content on BOTH sides
  const verifiedGutters: GutterCluster[] = [];

  for (const strip of emptyStrips) {
    const gutterLeft = pageBounds.x + strip.startBin * binWidth;
    const gutterRight = pageBounds.x + (strip.endBin + 1) * binWidth;
    const gutterCenter = (gutterLeft + gutterRight) / 2;

    let linesWithBothSides = 0;
    for (const line of lines) {
      const hasLeft = line.some(
        (t) => t.bbox.x + t.bbox.width < gutterCenter && t.bbox.x + t.bbox.width > pageBounds.x
      );
      const hasRight = line.some(
        (t) => t.bbox.x > gutterCenter && t.bbox.x < pageBounds.x + pageBounds.width
      );
      if (hasLeft && hasRight) linesWithBothSides++;
    }

    if (linesWithBothSides >= Math.max(MIN_GUTTER_LINE_COUNT, lines.length * MIN_GUTTER_LINES_RATIO)) {
      verifiedGutters.push({
        left: gutterLeft,
        right: gutterRight,
        centerX: gutterCenter,
        lineCount: linesWithBothSides,
      });
    }
  }

  if (verifiedGutters.length === 0) return [];

  return buildColumnRegions(verifiedGutters, pageBounds);
}

// ─── Shared: Clustering & Region Building ─────────────────────────────────────

function clusterGutters(
  candidates: GutterCandidate[],
  metrics: LayoutMetrics
): GutterCluster[] {
  if (candidates.length === 0) return [];

  // Clustering tolerance: use a generous fraction of page width
  const clusterTolerance = Math.max(
    metrics.gutterThreshold,
    metrics.pageWidth * 0.05
  );

  const sorted = [...candidates].sort((a, b) => a.centerX - b.centerX);
  const clusters: GutterCluster[] = [];

  for (const candidate of sorted) {
    const matching = clusters.find(
      (c) => Math.abs(c.centerX - candidate.centerX) <= clusterTolerance
    );

    if (matching) {
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

  const pageRight = pageBounds.x + pageBounds.width;
  if (pageRight > cursor) {
    regions.push({
      left: cursor,
      right: pageRight,
      index: regions.length,
    });
  }

  // Filter out regions narrower than 5% of page width
  const minColumnWidth = pageBounds.width * 0.05;
  const validRegions = regions.filter((r) => r.right - r.left >= minColumnWidth);

  return validRegions.length >= 2
    ? validRegions.map((r, i) => ({ ...r, index: i }))
    : [];
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

    if (band.isHeading) {
      groups.push({
        tokens: bandTokens,
        bbox: bandBounds,
        layoutRole: 'heading',
        bandIndex,
        columnIndex: 0,
      });
      continue;
    }

    // Detect columns within this band
    const columnRegions = detectColumnsInLines(band.lines, metrics, pageBounds);

    if (columnRegions.length < 2) {
      groups.push({
        tokens: bandTokens,
        bbox: bandBounds,
        layoutRole: 'flow',
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

function overlapWidth(a: OcrBoundingBox, b: OcrBoundingBox): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
}
