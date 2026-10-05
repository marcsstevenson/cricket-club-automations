import { describe, expect, it } from 'vitest';
import { otherLabel, squadLabels } from '../src/labels';

const p = (key: string, firstName: string, lastName: string) => ({ key, firstName, lastName });

describe('squadLabels', () => {
  it('uses first name and last initial', () => {
    const l = squadLabels([p('a', 'Logan', 'Smith'), p('b', 'Ava', 'jones')]);
    expect(l.get('a')).toBe('Logan S.');
    expect(l.get('b')).toBe('Ava J.');
  });

  it('extends the surname only as far as needed to tell players apart', () => {
    const l = squadLabels([p('a', 'Sam', 'Thompson'), p('b', 'Sam', 'Taylor'), p('c', 'Sam', 'Thomas')]);
    expect(l.get('a')).toBe('Sam Thomp.');
    expect(l.get('b')).toBe('Sam Ta.');
    expect(l.get('c')).toBe('Sam Thoma.');
  });

  it('appends the key ending when names are identical', () => {
    const l = squadLabels([p('p0412', 'Sam', 'Lee'), p('p0413', 'Sam', 'Lee')]);
    expect(l.get('p0412')).toBe('Sam L. (12)');
    expect(l.get('p0413')).toBe('Sam L. (13)');
  });

  it('falls back to the key ending when surnames differ only at the last letter', () => {
    const l = squadLabels([p('p0001', 'Sam', 'Lee'), p('p0002', 'Sam', 'Les')]);
    expect(l.get('p0001')).toBe('Sam L. (01)');
    expect(l.get('p0002')).toBe('Sam L. (02)');
  });

  it('never reveals a full surname when one surname is a prefix of another', () => {
    const l = squadLabels([p('p0001', 'Sam', 'Lee'), p('p0002', 'Sam', 'Leeson')]);
    expect(l.get('p0001')).toBe('Sam L. (01)');
    expect(l.get('p0002')).toBe('Sam Lees.');
  });

  it('treats first names case-insensitively when grouping', () => {
    const l = squadLabels([p('a', 'sam', 'Taylor'), p('b', 'Sam', 'Thompson')]);
    expect(l.get('a')).toBe('sam Ta.');
    expect(l.get('b')).toBe('Sam Th.');
  });
});

describe('otherLabel', () => {
  it('uses the first word and the initial of the last word', () => {
    expect(otherLabel('Mary Jane Smith')).toBe('Mary S.');
    expect(otherLabel('  chris   pratt ')).toBe('chris P.');
  });
  it('keeps a single word as-is', () => {
    expect(otherLabel('Coach')).toBe('Coach');
  });
});
