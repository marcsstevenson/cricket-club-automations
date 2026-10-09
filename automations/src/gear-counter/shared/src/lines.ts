import type { Line } from './types';

export function progressText(lines: Pick<Line, 'count'>[]) {
  const counted = lines.reduce((n, l) => n + l.count, 0);
  return `${counted} ${counted === 1 ? 'item' : 'items'} counted`;
}
