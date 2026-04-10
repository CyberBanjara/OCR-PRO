import { describe, expect, it } from 'vitest';
import { buildColumnLayout } from './column-layout';
import type { OcrToken } from '@/types/ocr';

function token(text: string, x: number, y: number): OcrToken {
  return {
    text,
    confidence: 95,
    bbox: {
      x,
      y,
      width: 30,
      height: 10,
    },
  };
}

describe('buildColumnLayout', () => {
  it('keeps single-column text together', () => {
    const layout = buildColumnLayout([
      token('Alpha', 20, 20),
      token('Beta', 70, 20),
      token('Gamma', 20, 40),
      token('Delta', 80, 40),
    ]);

    expect(layout.columns).toHaveLength(1);
    expect(layout.text).toBe('Alpha Beta\nGamma Delta');
  });

  it('orders text by detected columns before moving right', () => {
    const layout = buildColumnLayout([
      token('Left', 20, 20),
      token('One', 70, 20),
      token('Left', 20, 40),
      token('Two', 70, 40),
      token('Right', 220, 20),
      token('One', 275, 20),
      token('Right', 220, 40),
      token('Two', 275, 40),
    ]);

    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0].text).toBe('Left One\nLeft Two');
    expect(layout.columns[1].text).toBe('Right One\nRight Two');
    expect(layout.columns[0].layoutRole).toBe('side');
    expect(layout.columns[1].layoutRole).toBe('side');
    expect(layout.text).toBe('Left One\nLeft Two\n\nRight One\nRight Two');
  });

  it('keeps an isolated heading separate from parallel columns', () => {
    const layout = buildColumnLayout([
      token('Chapter', 140, 20),
      token('One', 205, 20),
      token('Left', 20, 120),
      token('Body', 70, 120),
      token('Left', 20, 140),
      token('More', 70, 140),
      token('Right', 220, 120),
      token('Body', 275, 120),
      token('Right', 220, 140),
      token('More', 275, 140),
    ]);

    expect(layout.columns).toHaveLength(3);
    expect(layout.columns[0].text).toBe('Chapter One');
    expect(layout.columns[0].layoutRole).toBe('heading');
    expect(layout.columns[1].text).toBe('Left Body\nLeft More');
    expect(layout.columns[1].layoutRole).toBe('side');
    expect(layout.columns[2].text).toBe('Right Body\nRight More');
    expect(layout.columns[2].layoutRole).toBe('side');
    expect(layout.text).toBe('Chapter One\n\nLeft Body\nLeft More\n\nRight Body\nRight More');
  });

  it('detects a stable page-wide separator before a narrow page-number strip', () => {
    const layout = buildColumnLayout([
      token('Topic', 20, 20),
      token('One', 70, 20),
      token('1', 320, 20),
      token('Topic', 20, 40),
      token('Two', 70, 40),
      token('9', 320, 40),
      token('Topic', 20, 60),
      token('Three', 70, 60),
      token('26', 320, 60),
    ]);

    expect(layout.columns).toHaveLength(2);
    expect(layout.columns[0].text).toBe('Topic One\nTopic Two\nTopic Three');
    expect(layout.columns[1].text).toBe('1\n9\n26');
    expect(layout.columns[1].layoutRole).toBe('side');
    expect(layout.text).toBe('Topic One\nTopic Two\nTopic Three\n\n1\n9\n26');
  });

  it('separates a wide body column from a narrow sidebar caption with a small gutter', () => {
    // Simulates a textbook layout: wide body text on the left,
    // narrow figure caption on the right. The gutter between columns
    // is small (~20px) but clearly larger than word spacing (~5px).
    function w(text: string, x: number, y: number, width = 30): OcrToken {
      return { text, confidence: 95, bbox: { x, y, width, height: 10 } };
    }

    const layout = buildColumnLayout([
      // Left column body (wrapping text, narrow word gaps ~5px)
      w('Now', 20, 20), w('look', 55, 20), w('at', 90, 20),
      w('the', 115, 20), w('names', 150, 20), w('of', 195, 20),
      w('the', 220, 20), w('different', 255, 20, 55), w('varieties', 315, 20, 50),

      w('cloth', 20, 40), w('in', 55, 40, 15), w('the', 75, 40),
      w('book.', 110, 40, 35), w('Amongst', 150, 40, 50), w('the', 205, 40),
      w('pieces', 240, 40, 40), w('ordered', 285, 40, 45), w('in', 335, 40, 15),
      w('bulk', 355, 40, 25),

      w('were', 20, 60), w('printed', 55, 60, 45), w('cotton', 105, 60, 40),
      w('cloths', 150, 60, 38), w('called', 193, 60, 38), w('chintz,', 236, 60, 42),
      w('cossaes', 283, 60, 45), w('(or', 333, 60, 20),

      w('term', 20, 80), w('chintz', 55, 80, 38), w('comes', 98, 80, 38),
      w('from?', 141, 80, 35), w('It', 181, 80, 12), w('is', 198, 80, 12),
      w('derived', 215, 80, 45), w('from', 265, 80, 28), w('the', 298, 80, 20),
      w('Hindi', 323, 80, 32),

      // Right column sidebar caption (starts at x=400, narrow ~20px gutter from body ending ~380)
      w('Fig.', 400, 40), w('4', 435, 40, 10), w('-', 450, 40, 8),
      w('Jamdani', 463, 40, 48), w('weave,', 516, 40, 38),

      w('Jamdani', 400, 60, 48), w('is', 453, 60, 12), w('a', 470, 60, 8),
      w('fine', 483, 60, 25), w('muslin', 513, 60, 38),

      w('which', 400, 80, 35), w('decorative', 440, 80, 60), w('motifs', 505, 80, 38),
    ]);

    expect(layout.columns.length).toBeGreaterThanOrEqual(2);

    // The left body column should be read first, fully top-to-bottom
    const leftCol = layout.columns[0];
    expect(leftCol.text).toContain('Now');
    expect(leftCol.text).toContain('bulk');
    expect(leftCol.text).toContain('Hindi');
    expect(leftCol.text).not.toContain('Jamdani');
    expect(leftCol.text).not.toContain('Fig.');

    // The right sidebar column should be read second, fully top-to-bottom
    const rightCol = layout.columns[layout.columns.length - 1];
    expect(rightCol.text).toContain('Fig.');
    expect(rightCol.text).toContain('Jamdani');
    expect(rightCol.text).toContain('motifs');
    expect(rightCol.text).not.toContain('Now');
    expect(rightCol.text).not.toContain('Hindi');
  });
});
