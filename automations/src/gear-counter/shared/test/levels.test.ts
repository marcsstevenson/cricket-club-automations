import { describe, expect, it } from 'vitest';
import { kitSpecQty } from '../src/data';
import { dateLabel, nzDate, nzDateTime, whenLabel } from '../src/dates';
import { levelsText } from '../src/levels';

describe('levelsText', () => {
  it('totals a bag or a pool', () => {
    expect(levelsText(1, 'team')).toBe('1 item in this bag');
    expect(levelsText(68, 'team')).toBe('68 items in this bag');
    expect(levelsText(0, 'pool')).toBe('0 items in this pool');
  });
});

describe('kitSpecQty', () => {
  it('reads the Kit Spec column, 0 for pools and unknown items', () => {
    expect(kitSpecQty('Kiwi Y1', 'STU-03')).toBe(1);
    expect(kitSpecQty('Kiwi Y1', 'BAT-W2')).toBe(0);
    expect(kitSpecQty(null, 'STU-03')).toBe(0);
    expect(kitSpecQty('Nope', 'STU-03')).toBe(0);
  });
});

describe('dates', () => {
  it('uses the New Zealand calendar day and clock', () => {
    expect(nzDate(new Date('2026-10-08T12:30:00Z'))).toBe('2026-10-09');
    expect(dateLabel('2026-10-09')).toBe('9 Oct 2026');
    expect(nzDateTime('2026-10-11T01:14:00.000Z')).toBe('2026-10-11 14:14');
    expect(whenLabel('2026-10-11T01:14:00.000Z')).toBe('11 Oct, 2:14 pm');
    expect(whenLabel('2026-10-10T20:05:00.000Z')).toBe('11 Oct, 9:05 am');
  });
});
