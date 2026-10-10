import { describe, expect, it } from 'vitest';
import { DOT_COLOURS, items, specColumns, specLines } from '../src/data';

describe('gear-data.json', () => {
  it('leaves out Senior kit, Misc and Other safety', () => {
    const cats = new Set(items.map((i) => i.category));
    for (const c of ['Senior kit', 'Misc', 'Other safety']) expect(cats.has(c)).toBe(false);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('gives every Kit Spec column catalogue items with quantities', () => {
    expect(specColumns).toEqual(expect.arrayContaining(['Kiwi Y1', 'Kiwi Y2', 'Year 3', 'Year 4', 'Div 5', 'Div 4', 'Year 5', 'Year 6', 'Year 7', 'Div 3 Hardball']));
    const ids = new Set(items.map((i) => i.id));
    for (const col of specColumns) {
      const lines = specLines(col);
      expect(lines.length, col).toBeGreaterThan(0);
      for (const l of lines) {
        expect(ids.has(l.item.id)).toBe(true);
        expect(l.expected).toBeGreaterThan(0);
      }
    }
  });

  it('gives a pool every item at 0', () => {
    const lines = specLines(null);
    expect(lines).toHaveLength(items.length);
    expect(lines.every((l) => l.expected === 0)).toBe(true);
  });

  it('has dot colours as hex', () => {
    for (const hex of Object.values(DOT_COLOURS)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
