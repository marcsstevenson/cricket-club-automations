import { describe, expect, it } from 'vitest';
import { priorWins, withWins } from '../src/awards';

describe('priorWins', () => {
  it('counts wins in other games', () => {
    expect(priorWins({ p1: ['g1', 'g2'] }, 'p1', 'g3')).toBe(2);
  });

  it('leaves out the game being reported', () => {
    expect(priorWins({ p1: ['g1', 'g2'] }, 'p1', 'g2')).toBe(1);
  });

  it('is 0 for players yet to win', () => {
    expect(priorWins({ p1: ['g1'] }, 'p2', 'g3')).toBe(0);
  });
});

describe('withWins', () => {
  it('appends the count, including 0', () => {
    expect(withWins('Ben S.', 2)).toBe('Ben S. (2)');
    expect(withWins('Ava B.', 0)).toBe('Ava B. (0)');
  });
});
