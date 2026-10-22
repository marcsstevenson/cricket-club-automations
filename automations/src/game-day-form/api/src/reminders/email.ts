import { formatGameDate } from '../../../shared/src/dates';
import type { Env } from '../env';
import type { FixtureGame } from '../playhq/fixture';
import type { Contacts } from './contacts';

export const FROM = 'Parklands Game Day <gameday@parklandscricket.co.nz>';
export const REPLY_TO = 'info@parklandscricket.co.nz';

export interface Email {
  subject: string;
  text: string;
  html: string;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The reminder for one team's unreported games on one day. `test` marks a sample sent from admin. */
export function reminderEmail(i: { team: { slug: string; name: string }; games: FixtureGame[]; siteUrl: string; test?: boolean }): Email {
  const { team, games } = i;
  const one = games.length === 1;
  const subject = `${i.test ? '[Test] ' : ''}${
    one ? `Game-day report needed: ${team.name} v ${games[0].opposition}` : `Game-day reports needed: ${team.name} (${games.length} games)`
  }`;
  const items = games.map((g) => ({
    title: `${g.round ? `${g.round} v ` : 'v '}${g.opposition}`,
    detail: [g.date ? formatGameDate(g.date) : '', g.venue].filter(Boolean).join(', '),
    link: `${i.siteUrl}/${team.slug}?game=${encodeURIComponent(g.gameId)}`,
  }));
  const intro = one
    ? `The game-day report for ${team.name} hasn't been filled in yet:`
    : `The game-day reports for ${team.name} haven't been filled in yet:`;
  const testNote = 'This is a test of the game-day reminder email. No action needed.';
  const footer = `You're getting this because you're on the reminder list for ${team.name}. To change who gets these, reply to this email.`;

  const text = [
    ...(i.test ? [testNote, ''] : []),
    'Hi,',
    '',
    intro,
    '',
    ...items.flatMap((g) => [`${g.title} (${g.detail})`, `Fill it in: ${g.link}`, '']),
    'It only takes a few minutes. Thanks!',
    '',
    'Parklands Cricket Club',
    '',
    footer,
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#02152b;line-height:1.5">
${i.test ? `<p style="background:#fff4d6;padding:8px 12px;border-radius:6px">${escape(testNote)}</p>` : ''}
<p>Hi,</p>
<p>${escape(intro)}</p>
${items
  .map(
    (g) => `<p><strong>${escape(g.title)}</strong><br>${escape(g.detail)}<br>
<a href="${escape(g.link)}" style="display:inline-block;margin-top:6px;padding:10px 16px;background:#02152b;color:#ffffff;text-decoration:none;border-radius:6px">Fill in the report</a></p>`,
  )
  .join('\n')}
<p>It only takes a few minutes. Thanks!</p>
<p>Parklands Cricket Club</p>
<p style="color:#5b6573;font-size:12px">${escape(footer)}</p>
</body></html>`;

  return { subject, text, html };
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

/** Sends through Resend's REST API. Never throws: failures come back as { ok: false }. */
export async function sendEmail(env: Env, fetchFn: typeof fetch, to: Contacts, email: Email, idempotencyKey?: string): Promise<SendResult> {
  try {
    const res = await fetchFn(`${env.RESEND_BASE_URL}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: FROM, to: to.to, ...(to.cc.length ? { cc: to.cc } : {}), reply_to: REPLY_TO, ...email }),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok || !body?.id) return { ok: false, error: `Resend ${res.status}: ${body?.message ?? 'no details'}` };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: `Resend unreachable: ${String(err)}` };
  }
}
