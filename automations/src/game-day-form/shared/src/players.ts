import type { PlayerChoice, PlayerRefOut } from './types';

/** True when a form/report player and a PlayHQ-derived player are the same person. */
export function samePlayer(a: PlayerChoice | null, b: PlayerRefOut): boolean {
  if (!a) return false;
  if (a.kind === 'squad' && b.kind === 'squad') return a.key === b.key;
  const aPhq = a.kind === 'playhq' || a.kind === 'named' ? a.playhqId : undefined;
  const bPhq = b.kind === 'playhq' || b.kind === 'named' ? b.playhqId : undefined;
  return !!aPhq && aPhq === bPhq;
}
