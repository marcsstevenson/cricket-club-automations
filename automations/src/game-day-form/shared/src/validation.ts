import type { FieldErrors, FormState, PlayerChoice } from './types';

export const LIMITS = {
  wkts: [0, 30],
  runs: [0, 999],
  bat: [25, 999],
  bowl: [3, 19],
  photos: 5,
} as const;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function checkInt(e: FieldErrors, path: string, v: number | null, [min, max]: readonly [number, number], what: string) {
  if (!isInt(v) || v < min || v > max) e[path] = `${what} must be a whole number from ${min} to ${max}.`;
}

function checkPlayer(e: FieldErrors, path: string, p: PlayerChoice | null) {
  if (!p) e[path] = 'Choose a player.';
  else if (p.kind === 'other' && !p.fullName.trim()) e[path] = "Enter the player's full name.";
}

export function playerIdentity(p: PlayerChoice): string {
  switch (p.kind) {
    case 'squad':
      return `s:${p.key}`;
    case 'named':
      return `n:${p.id}`;
    case 'playhq':
      return `p:${p.playhqId}`;
    case 'other':
      return `o:${p.fullName.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  }
}

/** Rules from functional spec §9. Returns {} when valid. */
export function validateReport(r: FormState): FieldErrors {
  const e: FieldErrors = {};
  if (!r.scoring) {
    e.scoring = 'Choose an answer.';
    return e;
  }

  if (r.scoring === 'not_played') {
    if (!r.notPlayedReason) e.notPlayedReason = 'Choose a reason.';
    else if (r.notPlayedReason === 'other' && !r.notPlayedOther.trim()) e.notPlayedOther = "Say why the game wasn't played.";
    return e;
  }

  if (r.scoring === 'yes_issues' && !r.issues.trim()) e.issues = 'Describe the issues.';

  for (const side of ['team', 'opp'] as const) {
    checkInt(e, `${side}.wkts`, r[side].wkts, LIMITS.wkts, 'Wickets');
    checkInt(e, `${side}.runs`, r[side].runs, LIMITS.runs, 'Runs');
  }

  checkPlayer(e, 'potd', r.potd);
  checkPlayer(e, 'mascot', r.mascot);

  if (r.photoIds.length > LIMITS.photos) e.photoIds = `You can add up to ${LIMITS.photos} photos.`;

  const seen = new Set<string>();
  r.milestones.forEach((m, i) => {
    const base = `milestones.${i}`;
    checkPlayer(e, `${base}.player`, m.player);
    if (m.type === 'bat') checkInt(e, `${base}.value`, m.value, LIMITS.bat, 'Runs');
    if (m.type === 'bowl') checkInt(e, `${base}.value`, m.value, LIMITS.bowl, 'Wickets');
    if (m.type === 'hattrick' && m.value !== null) e[`${base}.value`] = 'Hat-tricks have no number.';
    if (m.player && !(m.player.kind === 'other' && !m.player.fullName.trim())) {
      const id = `${m.type}|${playerIdentity(m.player)}`;
      if (seen.has(id)) e[`${base}.player`] = 'This player already has this milestone.';
      seen.add(id);
    }
  });

  return e;
}
