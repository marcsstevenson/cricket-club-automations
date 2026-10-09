import type { Line } from './types';

export type LineStatus = { kind: 'none' } | { kind: 'ok' } | { kind: 'short'; by: number } | { kind: 'over'; by: number };

/** Lines with nothing expected (pool and added lines) have no status. */
export function lineStatus(count: number, expected: number): LineStatus {
  if (expected === 0) return { kind: 'none' };
  if (count === expected) return { kind: 'ok' };
  return count < expected ? { kind: 'short', by: expected - count } : { kind: 'over', by: count - expected };
}

export const statusText = (s: LineStatus) => (s.kind === 'ok' ? '✓' : s.kind === 'short' ? `short ${s.by}` : s.kind === 'over' ? `+${s.by} over` : '');

export function progress(lines: Pick<Line, 'count' | 'expected'>[]) {
  const spec = lines.filter((l) => l.expected > 0);
  return {
    total: spec.length,
    complete: spec.filter((l) => l.count >= l.expected).length,
    missing: spec.reduce((n, l) => n + Math.max(0, l.expected - l.count), 0),
    counted: lines.reduce((n, l) => n + l.count, 0),
  };
}

export function progressText(lines: Pick<Line, 'count' | 'expected'>[]) {
  const p = progress(lines);
  if (p.total === 0) return `${p.counted} ${p.counted === 1 ? 'item' : 'items'} counted`;
  const head = `${p.complete} of ${p.total} lines complete`;
  return p.missing ? `${head} · ${p.missing} ${p.missing === 1 ? 'item' : 'items'} short` : head;
}
