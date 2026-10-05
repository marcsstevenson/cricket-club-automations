import * as v from 'valibot';
import type { TeamSummary } from '../../../shared/src/api';
import type { SquadPlayer } from '../../../shared/src/labels';
import type { Env } from '../env';
import { ApiError } from '../errors';

const NonBlank = v.pipe(v.string(), v.trim(), v.minLength(1));

const SquadSchema = v.object({
  season: v.object({ name: NonBlank, playhqSeasonId: NonBlank }),
  teams: v.array(
    v.object({
      slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
      name: NonBlank,
      playhqTeamId: NonBlank,
      playhqGradeId: v.optional(NonBlank),
      gradeName: v.optional(v.string()),
      mascot: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/))),
      players: v.array(
        v.object({
          key: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+$/)),
          firstName: NonBlank,
          lastName: NonBlank,
          playhqId: v.optional(NonBlank),
        }),
      ),
    }),
  ),
});

export type Squad = v.InferOutput<typeof SquadSchema>;
export type Team = Squad['teams'][number] & { players: SquadPlayer[] };

const invalid = (detail: unknown) => {
  console.error(JSON.stringify({ msg: 'squad_invalid', detail }));
  return new ApiError(500, 'squad_invalid', 'The squad data is invalid. Ask the club admin to re-upload it.');
};

export function parseSquad(json: unknown): Squad {
  const r = v.safeParse(SquadSchema, json);
  if (!r.success) throw invalid(v.flatten(r.issues));
  const slugs = new Set<string>();
  const keys = new Set<string>();
  for (const t of r.output.teams) {
    if (slugs.has(t.slug)) throw invalid(`duplicate squad slug ${t.slug}`);
    slugs.add(t.slug);
    for (const p of t.players) {
      if (keys.has(p.key)) throw invalid(`duplicate squad player key ${p.key}`);
      keys.add(p.key);
    }
  }
  return r.output;
}

let memo: { at: number; squad: Squad } | null = null;

export function resetSquadCache() {
  memo = null;
}

export async function loadSquad(env: Env, now: Date): Promise<Squad> {
  if (memo && now.getTime() - memo.at < 60_000) return memo.squad;
  const raw = await env.CONFIG.get('squad', 'json');
  if (!raw) throw new ApiError(500, 'squad_missing', 'Squad data has not been uploaded yet.');
  const squad = parseSquad(raw);
  memo = { at: now.getTime(), squad };
  return squad;
}

export function findTeam(squad: Squad, slug: string): Team {
  const team = squad.teams.find((t) => t.slug === slug.toLowerCase());
  if (!team) throw new ApiError(404, 'team_not_found', 'Team not found.');
  return team;
}

export const teamSummary = (t: Team): TeamSummary => ({ slug: t.slug, name: t.name, mascot: t.mascot ?? t.slug });
