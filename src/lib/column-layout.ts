import type { OcrBoundingBox, OcrColumn, OcrLayoutRole, OcrToken } from '@/types/ocr';

interface ColumnLayoutResult {
  text: string;
  columns: OcrColumn[];
}

interface LayoutMetrics {
  averageHeight: number;
  averageWidth: number;
  verticalThreshold: number;
  horizontalThreshold: number;
}

interface LayoutBlock {
  bbox: OcrBoundingBox;
  tokens: OcrToken[];
  text: string;
  layoutRole: OcrLayoutRole;
  vGap: number;
  hGap: number;
  trackIndex: number | null;
  spansSeparator: boolean;
}

interface LineSegment {
  bbox: OcrBoundingBox;
  tokens: OcrToken[];
  lineIndex: number;
}

interface ColumnSeparator {
  left: number;
  right: number;
  coverageHeight: number;
  rowCount: number;
}

interface RegionBand {
  index: number;
  bbox: OcrBoundingBox;
  left: number;
  right: number;
}

const MIN_COLUMN_TOKENS = 3;
const MIN_COLUMN_SHARE = 0.18;

export function buildColumnLayout(tokens: OcrToken[]): ColumnLayoutResult {
  const normalizedTokens = tokens
    .map(normalizeToken)
    .filter((token): token is OcrToken => token !== null);

  if (normalizedTokens.length === 0) {
    return { text: '', columns: [] };
  }

  const metrics = computeLayoutMetrics(normalizedTokens);
  const blocks = buildLayoutBlocks(normalizedTokens, metrics);
  const groups = buildReadingGroups(blocks, metrics);

  const columns = groups
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

function computeLayoutMetrics(tokens: OcrToken[]): LayoutMetrics {
  const heights = tokens.map((token) => token.bbox.height).sort((a, b) => a - b);
  const widths = tokens.map((token) => token.bbox.width).sort((a, b) => a - b);
  const averageHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const averageWidth = widths[Math.floor(widths.length / 2)] ?? 24;

  return {
    averageHeight,
    averageWidth,
    verticalThreshold: Math.max(10, averageHeight * 1.5),
    horizontalThreshold: Math.max(24, averageWidth * 1.8),
  };
}

function buildLayoutBlocks(tokens: OcrToken[], metrics: LayoutMetrics): LayoutBlock[] {
  const lines = groupTokensIntoLines(tokens);
  if (lines.length === 0) {
    return [];
  }

  const pageBounds = getBounds(lines.flat());
  const segments = lines.flatMap((line, lineIndex) =>
    splitLineIntoSegments(line, metrics).map((tokens) => ({
      tokens,
      bbox: getBounds(tokens),
      lineIndex,
    }))
  );
  const separators = detectStableSeparators(lines, metrics, pageBounds);
  const regions = buildRegionBands(pageBounds, separators, metrics);
  const rawBlocks = buildBlocksFromSegments(segments, separators, regions, metrics);
  const populatedTrackCount = new Set(
    rawBlocks
      .map((block) => block.trackIndex)
      .filter((trackIndex): trackIndex is number => trackIndex !== null)
  ).size;

  return rawBlocks.map((block) => {
    const { vGap, hGap } = measureBlockGaps(block, rawBlocks, metrics);
    return {
      ...block,
      vGap,
      hGap,
      layoutRole: classifyLayoutRole(
        block,
        rawBlocks,
        metrics,
        vGap,
        hGap,
        regions,
        populatedTrackCount
      ),
    };
  });
}

function splitLineIntoSegments(tokens: OcrToken[], metrics: LayoutMetrics): OcrToken[][] {
  const sorted = [...tokens].sort((a, b) => a.bbox.x - b.bbox.x);
  if (sorted.length === 0) {
    return [];
  }

  const segments: OcrToken[][] = [[sorted[0]]];
  let previousRight = sorted[0].bbox.x + sorted[0].bbox.width;

  for (let index = 1; index < sorted.length; index += 1) {
    const token = sorted[index];
    const gap = token.bbox.x - previousRight;

    if (gap > metrics.horizontalThreshold) {
      segments.push([token]);
    } else {
      segments[segments.length - 1].push(token);
    }

    previousRight = Math.max(previousRight, token.bbox.x + token.bbox.width);
  }

  return segments;
}

function measureBlockGaps(
  block: LayoutBlock,
  blocks: LayoutBlock[],
  metrics: LayoutMetrics
): { vGap: number; hGap: number } {
  let vGap = Number.POSITIVE_INFINITY;
  let hGap = Number.POSITIVE_INFINITY;

  for (const candidate of blocks) {
    if (candidate === block) continue;

    const verticalDistance = verticalGapBetween(block.bbox, candidate.bbox);
    const horizontalDistance = horizontalGapBetween(block.bbox, candidate.bbox);

    if (
      horizontalOverlapRatio(block.bbox, candidate.bbox) >= 0.18 ||
      horizontalDistance < metrics.horizontalThreshold
    ) {
      vGap = Math.min(vGap, verticalDistance);
    }

    if (
      verticalOverlapRatio(block.bbox, candidate.bbox) >= 0.18 ||
      verticalDistance < metrics.verticalThreshold
    ) {
      hGap = Math.min(hGap, horizontalDistance);
    }
  }

  return {
    vGap: Number.isFinite(vGap) ? vGap : 0,
    hGap: Number.isFinite(hGap) ? hGap : 0,
  };
}

function classifyLayoutRole(
  block: LayoutBlock,
  blocks: LayoutBlock[],
  metrics: LayoutMetrics,
  vGap: number,
  hGap: number,
  regions: RegionBand[],
  populatedTrackCount: number
): OcrLayoutRole {
  if (vGap > metrics.verticalThreshold && looksLikeHeading(block, blocks)) {
    return 'heading';
  }

  if (block.trackIndex !== null && populatedTrackCount > 1) {
    const region = regions.find((entry) => entry.index === block.trackIndex);
    const widestRegion = Math.max(...regions.map((entry) => entry.right - entry.left), 1);

    if (region && region.right - region.left <= widestRegion) {
      return 'side';
    }
  }

  if (vGap > metrics.verticalThreshold && hGap < metrics.horizontalThreshold) {
    return 'column';
  }

  if (hGap > metrics.horizontalThreshold && vGap < metrics.verticalThreshold) {
    return 'side';
  }

  return 'flow';
}

function looksLikeHeading(block: LayoutBlock, blocks: LayoutBlock[]): boolean {
  const lineCount = block.text.split('\n').length;
  const wordCount = block.text.split(/\s+/).filter(Boolean).length;
  const pageBounds = getBounds(blocks.flatMap((entry) => entry.tokens));
  const widthRatio = block.bbox.width / Math.max(pageBounds.width, 1);
  const pageCenter = pageBounds.x + pageBounds.width / 2;
  const blockCenter = block.bbox.x + block.bbox.width / 2;
  const centered = Math.abs(blockCenter - pageCenter) <= pageBounds.width * 0.2;

  return lineCount <= 2 && wordCount <= 12 && widthRatio < 0.7 && centered;
}

function buildReadingGroups(blocks: LayoutBlock[], metrics: LayoutMetrics): LayoutBlock[] {
  return [...blocks].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
}

function detectStableSeparators(
  lines: OcrToken[][],
  metrics: LayoutMetrics,
  pageBounds: OcrBoundingBox
): ColumnSeparator[] {
  const candidates: ColumnSeparator[] = [];

  for (const line of lines) {
    const segments = splitLineIntoSegments(line, metrics);
    if (segments.length < 2) continue;

    const lineBounds = getBounds(line);

    for (let index = 1; index < segments.length; index += 1) {
      const previous = getBounds(segments[index - 1]);
      const current = getBounds(segments[index]);
      const left = previous.x + previous.width;
      const right = current.x;
      const width = right - left;

      if (width < metrics.horizontalThreshold) {
        continue;
      }

      const existing = candidates.find((candidate) =>
        Math.abs(separatorCenter(candidate) - (left + right) / 2) <= metrics.horizontalThreshold
      );

      if (existing) {
        existing.left = (existing.left * existing.rowCount + left) / (existing.rowCount + 1);
        existing.right = (existing.right * existing.rowCount + right) / (existing.rowCount + 1);
        existing.coverageHeight += lineBounds.height;
        existing.rowCount += 1;
      } else {
        candidates.push({
          left,
          right,
          coverageHeight: lineBounds.height,
          rowCount: 1,
        });
      }
    }
  }

  const stable = candidates
    .filter((candidate) => {
      const coverageRatio = candidate.coverageHeight / Math.max(pageBounds.height, 1);
      const rowShare = candidate.rowCount / Math.max(lines.length, 1);
      const width = candidate.right - candidate.left;

      return (
        (coverageRatio >= 0.35 || rowShare >= 0.45) &&
        width >= metrics.horizontalThreshold * 0.9 &&
        candidate.rowCount >= 2
      );
    })
    .sort((a, b) => a.left - b.left);

  return mergeSeparators(stable, metrics);
}

function mergeSeparators(
  separators: ColumnSeparator[],
  metrics: LayoutMetrics
): ColumnSeparator[] {
  if (separators.length <= 1) {
    return separators;
  }

  const merged: ColumnSeparator[] = [separators[0]];

  for (let index = 1; index < separators.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = separators[index];

    if (current.left - previous.right <= metrics.averageWidth) {
      const totalRows = previous.rowCount + current.rowCount;
      previous.left = (previous.left * previous.rowCount + current.left * current.rowCount) / totalRows;
      previous.right = (previous.right * previous.rowCount + current.right * current.rowCount) / totalRows;
      previous.coverageHeight = Math.max(previous.coverageHeight, current.coverageHeight);
      previous.rowCount = totalRows;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

function buildRegionBands(
  pageBounds: OcrBoundingBox,
  separators: ColumnSeparator[],
  metrics: LayoutMetrics
): RegionBand[] {
  const regions: RegionBand[] = [];
  let cursor = pageBounds.x;
  let index = 0;

  for (const separator of separators) {
    if (separator.left - cursor >= metrics.averageWidth * 0.8) {
      regions.push({
        index,
        left: cursor,
        right: separator.left,
        bbox: {
          x: cursor,
          y: pageBounds.y,
          width: separator.left - cursor,
          height: pageBounds.height,
        },
      });
      index += 1;
    }

    cursor = separator.right;
  }

  const pageRight = pageBounds.x + pageBounds.width;
  if (pageRight - cursor >= metrics.averageWidth * 0.8) {
    regions.push({
      index,
      left: cursor,
      right: pageRight,
      bbox: {
        x: cursor,
        y: pageBounds.y,
        width: pageRight - cursor,
        height: pageBounds.height,
      },
    });
  }

  return regions;
}

function buildBlocksFromSegments(
  segments: LineSegment[],
  separators: ColumnSeparator[],
  regions: RegionBand[],
  metrics: LayoutMetrics
): LayoutBlock[] {
  const sorted = [...segments].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const blocks: LayoutBlock[] = [];
  const lastByTrack = new Map<number, LayoutBlock>();
  let lastSpanning: LayoutBlock | null = null;

  for (const segment of sorted) {
    const trackIndex = assignSegmentTrack(segment, separators, regions, metrics);
    const spansSeparator = overlapsAnySeparator(segment.bbox, separators);
    const candidate = createSegmentBlock(segment, trackIndex, spansSeparator);

    if (trackIndex !== null) {
      const previous = lastByTrack.get(trackIndex);
      if (previous && shouldMergeIntoTrack(previous, candidate, metrics)) {
        Object.assign(previous, mergeBlocks([previous, candidate], previous.layoutRole));
      } else {
        blocks.push(candidate);
        lastByTrack.set(trackIndex, candidate);
      }
      lastSpanning = null;
      continue;
    }

    if (lastSpanning && shouldMergeSpanningBlocks(lastSpanning, candidate, metrics)) {
      Object.assign(lastSpanning, mergeBlocks([lastSpanning, candidate], lastSpanning.layoutRole));
    } else {
      blocks.push(candidate);
      lastSpanning = candidate;
    }
  }

  return blocks;
}

function createSegmentBlock(
  segment: LineSegment,
  trackIndex: number | null,
  spansSeparator: boolean
): LayoutBlock {
  return {
    bbox: segment.bbox,
    tokens: segment.tokens,
    text: tokensToText(segment.tokens),
    layoutRole: 'flow',
    vGap: 0,
    hGap: 0,
    trackIndex,
    spansSeparator,
  };
}

function assignSegmentTrack(
  segment: LineSegment,
  separators: ColumnSeparator[],
  regions: RegionBand[],
  metrics: LayoutMetrics
): number | null {
  if (regions.length === 0 || overlapsAnySeparator(segment.bbox, separators)) {
    return null;
  }

  let bestRegion: RegionBand | null = null;
  let bestOverlap = 0;

  for (const region of regions) {
    const overlap = overlapWidth(segment.bbox, region.bbox);
    const ratio = overlap / Math.max(segment.bbox.width, 1);

    if (ratio > bestOverlap) {
      bestOverlap = ratio;
      bestRegion = region;
    }
  }

  return bestRegion && bestOverlap >= 0.65 ? bestRegion.index : null;
}

function overlapsAnySeparator(
  bbox: OcrBoundingBox,
  separators: ColumnSeparator[]
): boolean {
  return separators.some((separator) => overlapX(bbox, separator.left, separator.right) > 0);
}

function shouldMergeIntoTrack(
  current: LayoutBlock,
  next: LayoutBlock,
  metrics: LayoutMetrics
): boolean {
  const vGap = verticalGapBetween(current.bbox, next.bbox);
  const overlap = horizontalOverlapRatio(current.bbox, next.bbox);

  return vGap <= metrics.verticalThreshold * 1.5 && overlap >= 0.18;
}

function shouldMergeSpanningBlocks(
  current: LayoutBlock,
  next: LayoutBlock,
  metrics: LayoutMetrics
): boolean {
  const vGap = verticalGapBetween(current.bbox, next.bbox);
  const hGap = horizontalGapBetween(current.bbox, next.bbox);

  return vGap <= metrics.verticalThreshold && hGap < metrics.horizontalThreshold;
}

function separatorCenter(separator: ColumnSeparator): number {
  return (separator.left + separator.right) / 2;
}

function pickGroupRole(blocks: LayoutBlock[]): OcrLayoutRole {
  if (blocks.some((block) => block.layoutRole === 'heading')) {
    return 'heading';
  }

  if (blocks.some((block) => block.layoutRole === 'side')) {
    return 'side';
  }

  if (blocks.some((block) => block.layoutRole === 'column')) {
    return 'column';
  }

  return 'flow';
}

function mergeBlocks(blocks: LayoutBlock[], layoutRole = pickGroupRole(blocks)): LayoutBlock {
  const sortedTokens = sortTokens(blocks.flatMap((block) => block.tokens));

  return {
    bbox: getBounds(sortedTokens),
    tokens: sortedTokens,
    text: tokensToText(sortedTokens),
    layoutRole,
    vGap: Math.min(...blocks.map((block) => block.vGap)),
    hGap: Math.min(...blocks.map((block) => block.hGap)),
    trackIndex: blocks[0]?.trackIndex ?? null,
    spansSeparator: blocks.some((block) => block.spansSeparator),
  };
}

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

function mergeBounds(bounds: OcrBoundingBox[]): OcrBoundingBox {
  const minX = Math.min(...bounds.map((bbox) => bbox.x));
  const minY = Math.min(...bounds.map((bbox) => bbox.y));
  const maxX = Math.max(...bounds.map((bbox) => bbox.x + bbox.width));
  const maxY = Math.max(...bounds.map((bbox) => bbox.y + bbox.height));

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

function horizontalGapBetween(a: OcrBoundingBox, b: OcrBoundingBox): number {
  if (a.x <= b.x) {
    return Math.max(0, b.x - (a.x + a.width));
  }

  return Math.max(0, a.x - (b.x + b.width));
}

function horizontalOverlapRatio(a: OcrBoundingBox, b: OcrBoundingBox): number {
  const overlap = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  );

  return overlap / Math.max(Math.min(a.width, b.width), 1);
}

function verticalOverlapRatio(a: OcrBoundingBox, b: OcrBoundingBox): number {
  const overlap = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  );

  return overlap / Math.max(Math.min(a.height, b.height), 1);
}

function overlapWidth(a: OcrBoundingBox, b: OcrBoundingBox): number {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
}

function overlapX(bbox: OcrBoundingBox, left: number, right: number): number {
  return Math.max(0, Math.min(bbox.x + bbox.width, right) - Math.max(bbox.x, left));
}
