import { describe, expect, it } from 'vitest';
import { fromV2, isTapKey, mergeStored, parseTapKey, shortText, tapKey } from '../src/queue';

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

  it('skips old keys that are too short to read', () => {
    expect(fromV2({ 'pumas': 1, 'pumas|STU-04': 1, 'pumas|STU-04|Sam': 2 })).toEqual({ 'pumas|STU-04|a|Sam': 2 });
  });

  it('knows which keys have team, item, mode and name', () => {
    expect(isTapKey('pumas|STU-04|p|Sam')).toBe(true);
    expect(isTapKey('pumas|STU-04|a|')).toBe(true);
    expect(isTapKey('pumas|STU-04|a')).toBe(false);
    expect(isTapKey('junk')).toBe(false);
  });
});

describe('mergeStored', () => {
  it('drops malformed keys and non-numeric values, keeps the rest', () => {
    expect(mergeStored({ 'pumas|STU-04|a|Sam': 1, junk: 3, 'a|b|a': 2, 'x|y|p|Jo': 'no' as unknown as number }, {})).toEqual({ 'pumas|STU-04|a|Sam': 1 });
  });

  it('adds migrated v2 taps and omits entries that net to zero', () => {
    const merged = mergeStored({ 'pumas|STU-04|a|Sam': 2, 'pumas|FLD-TC|a|Sam': 1 }, { 'pumas|STU-04|Sam': -2, 'pumas|FLD-TC|Sam': 1, bad: 4 });
    expect(merged).toEqual({ 'pumas|FLD-TC|a|Sam': 2 });
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
