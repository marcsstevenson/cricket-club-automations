import { describe, expect, it } from 'vitest';
import { previousWinners, priorWins, winCounts, withWins } from '../src/awards';

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

describe('previousWinners', () => {
  const order = ['g1', 'g2', 'g3', 'g4'];

  it('lists winners newest first, leaving out the game being reported', () => {
    expect(previousWinners({ a: ['g1', 'g3'], b: ['g2', 'g4'] }, 'g4', order)).toEqual([
      { gameId: 'g3', key: 'a' },
      { gameId: 'g2', key: 'b' },
      { gameId: 'g1', key: 'a' },
    ]);
  });

  it('puts games missing from the fixture last', () => {
    expect(previousWinners({ a: ['old', 'g2'] }, 'g4', order).map((w) => w.gameId)).toEqual(['g2', 'old']);
  });

  it('is empty before any wins', () => {
    expect(previousWinners({}, 'g1', order)).toEqual([]);
  });
});

describe('winCounts', () => {
  const squad = [
    { key: 'a', label: 'Zoe A.' },
    { key: 'b', label: 'Ben S.' },
    { key: 'c', label: 'Ava B.' },
  ];

  it('lists every squad player, fewest wins first, then by name', () => {
    expect(winCounts({ a: ['g1'], b: ['g2', 'g3'] }, squad, 'g9')).toEqual([
      { key: 'c', label: 'Ava B.', wins: 0 },
      { key: 'a', label: 'Zoe A.', wins: 1 },
      { key: 'b', label: 'Ben S.', wins: 2 },
    ]);
  });

  it("doesn't count the game being reported", () => {
    expect(winCounts({ b: ['g2', 'g3'] }, squad, 'g3').find((p) => p.key === 'b')?.wins).toBe(1);
  });
});
