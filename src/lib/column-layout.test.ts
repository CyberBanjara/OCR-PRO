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

  it('detects a sidebar zone that only spans part of the page height', () => {
    // Simulates Image 2: body text spans full width at top and bottom,
    // but in the middle there's a figure caption sidebar on the left
    // while body text continues on the right. The sidebar only occupies
    // ~4 out of ~12 lines, so regular strategies fail. But the left-edge
    // clustering detects that some lines start at x≈20 while most start at x≈250.
    function w(text: string, x: number, y: number, width = 35): OcrToken {
      return { text, confidence: 95, bbox: { x, y, width, height: 12 } };
    }

    const layout = buildColumnLayout([
      // Top zone: body text spanning full width (lines start at x≈250)
      w('Let', 250, 20), w('us', 290, 20), w('first', 315, 20),
      w('look', 355, 20), w('at', 395, 20), w('textile', 420, 20, 48),
      w('production.', 473, 20, 70),

      w('Around', 250, 40), w('1750,', 295, 40), w('before', 340, 40, 42),
      w('the', 387, 40), w('British', 420, 40, 45),
      w('conquered', 470, 40, 60),

      w('Bengal,', 250, 60), w('India', 300, 60), w('was', 340, 60),
      w('by', 380, 60, 15), w('far', 400, 60),
      w('the', 440, 60), w('largest', 475, 60, 45),

      w('producer', 250, 80), w('of', 300, 80, 12), w('cotton', 317, 80, 42),
      w('textiles.', 364, 80, 55), w('Indian', 424, 80, 42),

      // Middle zone: sidebar caption on the LEFT + body continues on the RIGHT
      w('Fig.', 20, 120), w('2', 60, 120, 10), w('-', 75, 120, 8),
      w('Patola', 88, 120, 42), w('weave,', 135, 120, 38),
      w('is', 250, 120, 12), w('interesting', 267, 120, 70),
      w('to', 342, 120, 14), w('trace', 361, 120, 35),

      w('mid-nineteenth', 20, 140, 85), w('century', 110, 140, 48),
      w('the', 250, 140), w('origin', 290, 140, 40), w('of', 335, 140, 12),
      w('such', 352, 140, 28), w('words,', 385, 140, 38),

      w('Patola', 20, 160, 42), w('was', 67, 160),
      w('woven', 105, 160, 38), w('in', 148, 160, 12),
      w('and', 250, 160), w('see', 290, 160), w('what', 325, 160),
      w('they', 365, 160), w('tell', 405, 160), w('us.', 445, 160, 18),

      w('Surat,', 20, 180, 40), w('Ahmedabad', 65, 180, 65),
      w('Words', 250, 180, 42), w('tell', 297, 180),
      w('us', 337, 180, 14), w('histories', 356, 180, 55),

      // Bottom zone: body text again full width (lines start at x≈250)
      w('European', 250, 220, 55), w('traders', 310, 220, 44),
      w('first', 359, 220), w('encountered', 399, 220, 72),

      w('fine', 250, 240), w('cotton', 290, 240, 42), w('cloth', 337, 240),
      w('from', 377, 240), w('India', 417, 240),
    ]);

    // Must detect at least the sidebar zone split
    expect(layout.columns.length).toBeGreaterThanOrEqual(2);

    // Sidebar text (Fig. 2 caption) should NOT be mixed with body text
    const allText = layout.columns.map(c => c.text).join(' | ');
    const sidebarCol = layout.columns.find(c => c.text.includes('Patola'));
    const bodyCol = layout.columns.find(c => c.text.includes('European'));

    expect(sidebarCol).toBeDefined();
    expect(bodyCol).toBeDefined();

    // Sidebar should have figure caption tokens
    expect(sidebarCol!.text).toContain('Fig.');
    expect(sidebarCol!.text).toContain('Patola');

    // Body should not contain sidebar text
    expect(bodyCol!.text).not.toContain('Fig.');
    expect(bodyCol!.text).not.toContain('Patola');
  });
});
