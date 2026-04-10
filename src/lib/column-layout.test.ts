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
});
