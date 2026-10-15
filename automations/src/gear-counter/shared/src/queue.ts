/** How a queued tap is sent: a plain adjust, or a Club pool tap (spec §4.1, §4.5). */
export type TapMode = 'plain' | 'pool';

export interface TapKey {
  team: string;
  item: string;
  mode: TapMode;
  who: string;
}

/** team|item|a-or-p|who. Slugs and item ids never contain '|'; the name may, so it is everything after the third. */
export const tapKey = (k: TapKey) => `${k.team}|${k.item}|${k.mode === 'pool' ? 'p' : 'a'}|${k.who}`;

export function parseTapKey(key: string): TapKey {
  const [team, item, m] = key.split('|', 3);
  return { team, item, mode: m === 'p' ? 'pool' : 'plain', who: key.slice(team.length + item.length + m.length + 3) };
}

/** True when a stored key has team, item, mode and name parts (the name may be empty). */
export const isTapKey = (key: string) => key.split('|', 4).length === 4;

/** Keys queued before Club pool taps were team|item|who and were always plain taps. Keys without all three parts are skipped. */
export function fromV2(old: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(old).flatMap(([key, n]) => {
      if (key.split('|', 3).length < 3) return [];
      const [team, item] = key.split('|', 2);
      return [[tapKey({ team, item, mode: 'plain', who: key.slice(team.length + item.length + 2) }), n]];
    }),
  );
}

/** Stored v3 taps plus migrated v2 taps, without malformed keys, non-numeric values or taps that net to nothing. */
export function mergeStored(v3: Record<string, number>, v2: Record<string, number>): Record<string, number> {
  const sum: Record<string, number> = {};
  for (const [k, n] of [...Object.entries(v3), ...Object.entries(fromV2(v2))]) {
    if (isTapKey(k) && Number.isFinite(n)) sum[k] = (sum[k] ?? 0) + n;
  }
  return Object.fromEntries(Object.entries(sum).filter(([, n]) => n !== 0));
}

const wasnt = (n: number) => (n === 1 ? "wasn't" : "weren't");

/** Notice when a synced Club pool + applied less than was tapped (spec §4.5). */
export function shortText(name: string, applied: number, short: number) {
  return applied > 0
    ? `Club pool only had ${applied} ${name}; the other ${short} ${wasnt(short)} added.`
    : `None left in the Club pool: ${short} ${name} ${wasnt(short)} added.`;
}
