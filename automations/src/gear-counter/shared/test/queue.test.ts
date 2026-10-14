import { describe, expect, it } from 'vitest';
import { fromV2, parseTapKey, shortText, tapKey } from '../src/queue';

describe('tap keys', () => {
  it('round-trips team, item, mode and a name containing |', () => {
    const k = { team: 'pumas', item: 'STU-04', mode: 'pool' as const, who: 'Sam|Jo' };
    expect(tapKey(k)).toBe('pumas|STU-04|p|Sam|Jo');
    expect(parseTapKey(tapKey(k))).toEqual(k);
    expect(parseTapKey(tapKey({ ...k, mode: 'plain' }))).toEqual({ ...k, mode: 'plain' });
  });

  it('turns taps queued before Club pool taps into plain taps', () => {
    expect(fromV2({ 'pumas|STU-04|Sam|Jo': 2, 'pool|FLD-TC|Jo': -1 })).toEqual({ 'pumas|STU-04|a|Sam|Jo': 2, 'pool|FLD-TC|a|Jo': -1 });
  });
});

describe('shortText', () => {
  it('says what the Club pool could not cover', () => {
    expect(shortText('Tall cones', 2, 1)).toBe("Club pool only had 2 Tall cones; the other 1 wasn't added.");
    expect(shortText('Tall cones', 1, 3)).toBe("Club pool only had 1 Tall cones; the other 3 weren't added.");
    expect(shortText('Bails (pair)', 0, 1)).toBe("None left in the Club pool: 1 Bails (pair) wasn't added.");
    expect(shortText('Bails (pair)', 0, 2)).toBe("None left in the Club pool: 2 Bails (pair) weren't added.");
  });
});
