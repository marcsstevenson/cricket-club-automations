import { describe, expect, it } from 'vitest';
import { dateLabel, nzDate } from '../src/dates';
import { progressText } from '../src/lines';

describe('progressText', () => {
  it('totals the counts without comparing to the Kit Spec', () => {
    expect(progressText([{ count: 1 }])).toBe('1 item counted');
    expect(progressText([{ count: 4 }, { count: 0 }, { count: 2 }])).toBe('6 items counted');
    expect(progressText([])).toBe('0 items counted');
  });
});

describe('dates', () => {
  it('uses the New Zealand calendar day', () => {
    expect(nzDate(new Date('2026-10-08T12:30:00Z'))).toBe('2026-10-09');
    expect(dateLabel('2026-10-09')).toBe('9 Oct 2026');
  });
});
