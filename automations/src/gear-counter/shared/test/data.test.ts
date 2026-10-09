import { describe, expect, it } from 'vitest';
import raw from '../src/gear-data.json';
import { DOT_COLOURS, findTeam, items, specLines, teamSummaries } from '../src/data';

describe('gear-data.json', () => {
  it('leaves out Senior kit, Misc and Other safety', () => {
    const cats = new Set(items.map((i) => i.category));
    for (const c of ['Senior kit', 'Misc', 'Other safety']) expect(cats.has(c)).toBe(false);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('gives every team a non-empty spec of catalogue items', () => {
    const ids = new Set(items.map((i) => i.id));
    for (const t of raw.teams) {
      const lines = specLines(findTeam(t.slug)!);
      expect(lines.length, t.slug).toBeGreaterThan(0);
      for (const l of lines) {
        expect(ids.has(l.item.id)).toBe(true);
        expect(l.expected).toBeGreaterThan(0);
      }
    }
  });

  it('uses known dot colours', () => {
    for (const t of teamSummaries()) if (t.dot) expect(DOT_COLOURS[t.dot], `${t.slug} ${t.dot}`).toBeDefined();
  });

  it('maps Kiwi Year 1/2 teams to the Kiwi Y1 kit', () => {
    expect(raw.teams.find((t) => t.slug === 'lions')).toMatchObject({ grade: 'Kiwi Year 1/2', spec: 'Kiwi Y1' });
  });
});
