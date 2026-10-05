import { describe, expect, it } from 'vitest';
import { formatGameDate, nzDate } from '../src/dates';

describe('nzDate', () => {
  it('converts UTC to the NZ calendar date (summer, +13)', () => {
    expect(nzDate(new Date('2026-01-30T20:00:00Z'))).toBe('2026-01-31');
  });
  it('handles winter time (+12) on either side of midnight', () => {
    expect(nzDate(new Date('2026-07-01T11:59:00Z'))).toBe('2026-07-01');
    expect(nzDate(new Date('2026-07-01T12:00:00Z'))).toBe('2026-07-02');
  });
});

describe('formatGameDate', () => {
  it('formats as short weekday, day and month', () => {
    expect(formatGameDate('2026-01-31')).toBe('Sat 31 Jan');
    expect(formatGameDate('2026-10-05')).toBe('Mon 5 Oct');
  });
});
