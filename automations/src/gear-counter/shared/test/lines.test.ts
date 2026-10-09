import { describe, expect, it } from 'vitest';
import { dateLabel, nzDate } from '../src/dates';
import { progressText } from '../src/lines';

describe('progressText', () => {
  it('counts complete lines and missing items', () => {
    const lines = [
      { count: 2, expected: 2 },
      { count: 0, expected: 3 },
      { count: 6, expected: 5 },
      { count: 1, expected: 0 },
    ];
    expect(progressText(lines)).toBe('2 of 3 lines complete · 3 items short');
    expect(progressText([{ count: 2, expected: 2 }])).toBe('1 of 1 lines complete');
  });

  it('just totals the pool', () => {
    expect(progressText([{ count: 1, expected: 0 }])).toBe('1 item counted');
    expect(progressText([{ count: 4, expected: 0 }, { count: 0, expected: 0 }])).toBe('4 items counted');
  });
});

describe('dates', () => {
  it('uses the New Zealand calendar day', () => {
    expect(nzDate(new Date('2026-10-08T12:30:00Z'))).toBe('2026-10-09');
    expect(dateLabel('2026-10-09')).toBe('9 Oct 2026');
  });
});
