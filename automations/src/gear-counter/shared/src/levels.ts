import type { TeamKind } from './types';

export function levelsText(total: number, kind: TeamKind) {
  return `${total} ${total === 1 ? 'item' : 'items'} in this ${kind === 'pool' ? 'pool' : 'bag'}`;
}
