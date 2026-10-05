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
    expect(l.get('p0412')).toBe('Sam Lee. (12)');
    expect(l.get('p0413')).toBe('Sam Lee. (13)');
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
