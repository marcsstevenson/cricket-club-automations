import type { FieldErrors, PlayerChoice } from '../../../shared/src/types';
import type { V2Summary } from '../playhq/types';
import type { Team } from '../squad/load';
import type { NamedPlayer, StoredReport } from './repo';

export function makeResolver(o: { team: Team; existing: StoredReport | null; summary: V2Summary | null; newId: () => string }) {
  const newNamed: NamedPlayer[] = [];
  const fields: FieldErrors = {};
  const squadKeys = new Set(o.team.players.map((p) => p.key));
  const appearances = new Map((o.summary?.appearances ?? []).map((a) => [a.id, a]));

  function resolve(path: string, ref: PlayerChoice | null): { key: string | null; namedId: string | null } {
    if (!ref) return { key: null, namedId: null };
    switch (ref.kind) {
      case 'squad':
        if (!squadKeys.has(ref.key)) fields[path] = 'This player is not in the squad.';
        return { key: ref.key, namedId: null };
      case 'named':
        if (!o.existing?.named.has(ref.id)) fields[path] = 'This player is not part of this report.';
        return { key: null, namedId: ref.id };
      case 'other': {
        const id = o.newId();
        newNamed.push({ id, fullName: ref.fullName.trim().replace(/\s+/g, ' '), playhqId: null });
        return { key: null, namedId: id };
      }
      case 'playhq': {
        const a = appearances.get(ref.playhqId);
        if (!a) {
          fields[path] = 'This PlayHQ player is not in this game.';
          return { key: null, namedId: null };
        }
        const id = o.newId();
        newNamed.push({ id, fullName: `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || 'Unnamed player', playhqId: a.id });
        return { key: null, namedId: id };
      }
    }
  }

  return { resolve, newNamed, fields };
}
