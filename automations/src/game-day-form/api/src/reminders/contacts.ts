import type { ReminderTeam } from '../../../shared/src/api';
import type { Squad } from '../squad/load';

export const MAX_ADDRESSES = 10;
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export type Contacts = { to: string[]; cc: string[] };
export type Checked = ({ ok: true } & Contacts) | { ok: false; error: string };

const tidy = (list: unknown): string[] =>
  Array.isArray(list) ? [...new Set(list.map((a) => String(a).trim().toLowerCase()).filter(Boolean))] : [];

/** Cleans a team's lists: trimmed, lower-case, no repeats, Cc minus anything already in To. */
export function validateContacts(input: { to?: unknown; cc?: unknown }): Checked {
  const to = tidy(input.to);
  const cc = tidy(input.cc).filter((a) => !to.includes(a));
  const bad = [...to, ...cc].find((a) => a.length > 254 || !EMAIL.test(a));
  if (bad) return { ok: false, error: `"${bad}" isn't an email address.` };
  if (to.length > MAX_ADDRESSES || cc.length > MAX_ADDRESSES) return { ok: false, error: `Up to ${MAX_ADDRESSES} addresses in each list.` };
  if (!to.length && cc.length) return { ok: false, error: 'Add a To address before any Cc addresses.' };
  return { ok: true, to, cc };
}

export async function loadContacts(db: D1Database): Promise<Map<string, Contacts>> {
  const { results } = await db.prepare('SELECT team_slug, to_emails, cc_emails FROM team_reminders').all<{ team_slug: string; to_emails: string; cc_emails: string }>();
  return new Map(results.map((r) => [r.team_slug, { to: JSON.parse(r.to_emails), cc: JSON.parse(r.cc_emails) }]));
}

export async function saveContacts(db: D1Database, lists: Map<string, Contacts>, now: Date) {
  if (!lists.size) return;
  await db.batch(
    [...lists].map(([slug, c]) =>
      db
        .prepare(
          `INSERT INTO team_reminders (team_slug, to_emails, cc_emails, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (team_slug) DO UPDATE SET to_emails = excluded.to_emails, cc_emails = excluded.cc_emails, updated_at = excluded.updated_at`,
        )
        .bind(slug, JSON.stringify(c.to), JSON.stringify(c.cc), now.toISOString()),
    ),
  );
}

/** Every squad team with its lists (empty when none are saved). */
export function reminderTeams(squad: Squad, contacts: Map<string, Contacts>): ReminderTeam[] {
  return squad.teams.map((t) => ({ slug: t.slug, name: t.name, to: contacts.get(t.slug)?.to ?? [], cc: contacts.get(t.slug)?.cc ?? [] }));
}
