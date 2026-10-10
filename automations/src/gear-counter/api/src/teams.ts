import { DOT_COLOURS, MASCOTS, specColumns } from '../../shared/src/data';
import type { AdminTeam, NewTeam, TeamKind, TeamSummary } from '../../shared/src/types';
import { ApiError } from './errors';

export interface TeamRow {
  slug: string;
  name: string;
  kind: TeamKind;
  mascot: string;
  grade: string | null;
  spec: string | null;
  dot: string | null;
  sort: number;
  hidden: number;
}

export const summary = (r: TeamRow): TeamSummary => ({ slug: r.slug, name: r.name, kind: r.kind, mascot: r.mascot, grade: r.grade, dot: r.dot });

// Teams first, then pools; each in sort order.
const ORDER = "ORDER BY kind = 'pool', sort, name";

export async function listTeams(db: D1Database, includeHidden = false): Promise<TeamRow[]> {
  const { results } = await db.prepare(`SELECT * FROM teams ${includeHidden ? '' : 'WHERE hidden = 0'} ${ORDER}`).all<TeamRow>();
  return results;
}

/** A visible team or pool, else 404. */
export async function getTeam(db: D1Database, slug: string): Promise<TeamRow> {
  const row = await db.prepare('SELECT * FROM teams WHERE slug = ? AND hidden = 0').bind(slug.toLowerCase()).first<TeamRow>();
  if (!row) throw new ApiError(404, 'team_not_found', 'Team not found.');
  return row;
}

export async function adminTeams(db: D1Database): Promise<AdminTeam[]> {
  const { results } = await db
    .prepare(`SELECT t.*, (SELECT MAX(date) FROM stocktakes s WHERE s.team_slug = t.slug) AS latest FROM teams t ${ORDER}`)
    .all<TeamRow & { latest: string | null }>();
  return results.map(toAdmin);
}

const toAdmin = (r: TeamRow & { latest: string | null }): AdminTeam => ({ ...summary(r), spec: r.spec, hidden: r.hidden === 1, latest: r.latest });

const SLUG = /^[a-z][a-z0-9-]{1,29}$/;
const RESERVED = new Set(['admin', 'api']);

const bad = (message: string) => new ApiError(400, 'invalid_team', message);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Checks an add-team request and fills in defaults. */
export function parseNewTeam(body: unknown): Required<NewTeam> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== 'team' && kind !== 'pool') throw bad('Choose a team or a pool.');
  const name = text(b.name);
  if (!name || name.length > 60) throw bad('Enter a name of up to 60 characters.');
  const slug = text(b.slug).toLowerCase();
  if (!SLUG.test(slug) || RESERVED.has(slug)) {
    throw bad('The web address must be 2–30 lowercase letters, numbers or dashes, start with a letter, and not be "admin" or "api".');
  }
  const mascot = text(b.mascot);
  if (mascot && !MASCOTS.includes(mascot)) throw bad('Unknown mascot.');
  if (kind === 'pool') return { kind, name, slug, spec: null, grade: null, dot: null, mascot };
  const spec = text(b.spec);
  if (!specColumns.includes(spec)) throw bad('Choose a Kit Spec column.');
  const grade = text(b.grade) || spec;
  if (grade.length > 40) throw bad('The grade must be up to 40 characters.');
  const dot = text(b.dot).toLowerCase() || null;
  if (dot && !DOT_COLOURS[dot]) throw bad('Unknown dot colour.');
  return { kind, name, slug, spec, grade, dot, mascot };
}

export async function addTeam(db: D1Database, t: Required<NewTeam>, now: Date): Promise<AdminTeam> {
  const clash = await db
    .prepare('SELECT slug, name FROM teams WHERE slug = ? OR name = ? COLLATE NOCASE')
    .bind(t.slug, t.name)
    .first<{ slug: string; name: string }>();
  if (clash) {
    throw new ApiError(409, 'team_exists', clash.slug === t.slug ? `The web address /${t.slug} is already used.` : `${clash.name} already exists.`);
  }
  // New teams go after the existing teams, new pools after the existing pools.
  await db
    .prepare(
      `INSERT INTO teams (slug, name, kind, mascot, grade, spec, dot, sort, hidden, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, (SELECT COALESCE(MAX(sort), 0) + 10 FROM teams WHERE kind = ?3), 0, ?8)`,
    )
    .bind(t.slug, t.name, t.kind, t.mascot, t.grade, t.spec, t.dot, now.toISOString())
    .run();
  return (await adminTeams(db)).find((x) => x.slug === t.slug)!;
}

export async function setHidden(db: D1Database, slug: string, hidden: boolean): Promise<AdminTeam> {
  const { meta } = await db.prepare('UPDATE teams SET hidden = ? WHERE slug = ?').bind(hidden ? 1 : 0, slug).run();
  if (!meta.changes) throw new ApiError(404, 'team_not_found', 'Team not found.');
  return (await adminTeams(db)).find((x) => x.slug === slug)!;
}
