import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReminderTeam } from '../../shared/src/api';
import { createApp } from '../src/app';
import type { Env } from '../src/env';
import { validateContacts } from '../src/reminders/contacts';
import { nzHour, runReminders } from '../src/reminders/run';
import { form, pumasRoutes, put } from './builders';
import { call, seedSquad, testDeps } from './helpers';

const SIX_PM = new Date('2026-01-31T05:00:00Z'); // Sat 31 Jan, 6 pm NZDT: g2's game day
const RESEND = 'https://api.resend.com/emails';
const ADMIN = { 'x-admin-passcode': 'letmein' };

type Sent = { body: Record<string, unknown>; headers: Headers };

/** PlayHQ fake plus a Resend fake that records what was sent. */
function routes(resend: () => Response = () => Response.json({ id: 'em_1' })) {
  const phq = pumasRoutes();
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === RESEND) {
      sent.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
      return resend();
    }
    return phq.fetch(input, init);
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

async function saveContacts(slug: string, to: string[], cc: string[] = []) {
  await env.DB.prepare('INSERT INTO team_reminders (team_slug, to_emails, cc_emails, updated_at) VALUES (?, ?, ?, ?)')
    .bind(slug, JSON.stringify(to), JSON.stringify(cc), '2026-01-01T00:00:00Z')
    .run();
}

const run = (r: ReturnType<typeof routes>, now = SIX_PM, e: Env = env) =>
  runReminders(e, testDeps({ fetch: r.fetch, now: () => now }), () => {});

describe('validateContacts', () => {
  it('trims, lower-cases and de-duplicates, dropping Cc addresses already in To', () => {
    expect(validateContacts({ to: [' Coach@Example.com', 'coach@example.com', 'b@x.nz'], cc: ['B@x.nz', 'm@x.nz', ''] })).toEqual({
      ok: true,
      to: ['coach@example.com', 'b@x.nz'],
      cc: ['m@x.nz'],
    });
  });

  it('rejects bad addresses, Cc without To, and long lists', () => {
    expect(validateContacts({ to: ['not-an-email'], cc: [] })).toMatchObject({ ok: false, error: expect.stringContaining('not-an-email') });
    expect(validateContacts({ to: [], cc: ['m@x.nz'] })).toMatchObject({ ok: false, error: 'Add a To address before any Cc addresses.' });
    const many = Array.from({ length: 11 }, (_, i) => `p${i}@x.nz`);
    expect(validateContacts({ to: many, cc: [] })).toMatchObject({ ok: false, error: 'Up to 10 addresses in each list.' });
  });

  it('allows a team with no addresses', () => {
    expect(validateContacts({ to: [], cc: [] })).toEqual({ ok: true, to: [], cc: [] });
  });
});

describe('runReminders', () => {
  beforeEach(() => seedSquad());

  it('emails a team with an unreported game today, once', async () => {
    await saveContacts('pumas', ['coach@example.com'], ['manager@example.com']);
    const r = routes();
    expect(await run(r)).toEqual({ sent: 1, failed: 0 });
    expect(r.sent).toHaveLength(1);
    const { body, headers } = r.sent[0];
    expect(body).toMatchObject({
      from: 'Parklands Game Day <gameday@parklandscricket.co.nz>',
      to: ['coach@example.com'],
      cc: ['manager@example.com'],
      reply_to: 'info@parklandscricket.co.nz',
      subject: 'Game-day report needed: Parklands Pumas v Syd Martin Scorchers',
    });
    expect(body.text).toContain('https://gameday.parklandscricket.co.nz/pumas?game=g2');
    expect(body.html).toContain('https://gameday.parklandscricket.co.nz/pumas?game=g2');
    expect(body.text).toContain('R4 v Syd Martin Scorchers');
    expect(headers.get('authorization')).toBe('Bearer test-resend');
    expect(headers.get('idempotency-key')).toBe('reminder-pumas-2026-01-31');

    expect(await run(r, new Date('2026-01-31T06:00:00Z'))).toEqual({ sent: 0, failed: 0 }); // the 7 pm run
    expect(r.sent).toHaveLength(1);
  });

  it('waits until 6 pm in New Zealand', async () => {
    await saveContacts('pumas', ['coach@example.com']);
    const r = routes();
    expect(await run(r, new Date('2026-01-31T04:59:00Z'))).toEqual({ sent: 0, failed: 0 });
    expect(r.sent).toHaveLength(0);
  });

  it('reads the hour in New Zealand across daylight saving', () => {
    expect(nzHour(new Date('2026-01-31T05:00:00Z'))).toBe(18); // NZDT: the 05:00 UTC run is 6 pm
    expect(nzHour(new Date('2026-06-13T05:00:00Z'))).toBe(17); // NZST: the 05:00 UTC run is 5 pm…
    expect(nzHour(new Date('2026-06-13T06:00:00Z'))).toBe(18); // …and the 06:00 UTC run is 6 pm
  });

  it('skips games that are already reported', async () => {
    await saveContacts('pumas', ['coach@example.com']);
    const r = routes();
    await put(createApp(testDeps({ fetch: r.fetch, now: () => SIX_PM })), 'g2', form());
    expect(await run(r)).toEqual({ sent: 0, failed: 0 });
    expect(r.sent).toHaveLength(0);
  });

  it('skips teams with no To addresses', async () => {
    await saveContacts('pumas', []);
    const r = routes();
    expect(await run(r)).toEqual({ sent: 0, failed: 0 });
    expect(r.sent).toHaveLength(0);
  });

  it('skips days without a game', async () => {
    await saveContacts('pumas', ['coach@example.com']);
    const r = routes();
    expect(await run(r, new Date('2026-01-30T05:00:00Z'))).toEqual({ sent: 0, failed: 0 });
    expect(r.sent).toHaveLength(0);
  });

  it('retries a failed send on the next run', async () => {
    await saveContacts('pumas', ['coach@example.com']);
    let fail = true;
    const r = routes(() => (fail ? Response.json({ message: 'down' }, { status: 500 }) : Response.json({ id: 'em_2' })));
    expect(await run(r)).toEqual({ sent: 0, failed: 1 });
    const failed = await env.DB.prepare('SELECT status, attempts, error FROM reminder_log').first();
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, error: expect.stringContaining('500') });

    fail = false;
    expect(await run(r, new Date('2026-01-31T06:00:00Z'))).toEqual({ sent: 1, failed: 0 });
    expect(await env.DB.prepare('SELECT status, attempts, resend_id FROM reminder_log').first()).toMatchObject({ status: 'sent', attempts: 2, resend_id: 'em_2' });
  });

  it('does nothing without a Resend key', async () => {
    await saveContacts('pumas', ['coach@example.com']);
    const r = routes();
    expect(await run(r, SIX_PM, { ...env, RESEND_API_KEY: '' })).toEqual({ sent: 0, failed: 0 });
    expect(r.sent).toHaveLength(0);
  });
});

describe('admin reminder settings', () => {
  beforeEach(() => seedSquad());

  const json = (method: string, body: unknown) => ({ method, headers: { ...ADMIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('needs the admin passcode', async () => {
    const app = createApp(testDeps());
    expect((await call(app, '/api/admin/reminders')).status).toBe(401);
    expect((await call(app, '/api/admin/reminders', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    expect((await call(app, '/api/admin/reminders/pumas/test', { method: 'POST' })).status).toBe(401);
  });

  it('lists every squad team, saves the lists, and keeps them out of public pages', async () => {
    const r = routes();
    const app = createApp(testDeps({ fetch: r.fetch }));
    const empty = await (await call(app, '/api/admin/reminders', { headers: ADMIN })).json<{ teams: ReminderTeam[] }>();
    expect(empty.teams).toEqual([
      { slug: 'pumas', name: 'Parklands Pumas', to: [], cc: [] },
      { slug: 'tigers', name: 'Parklands Tigers', to: [], cc: [] },
    ]);

    const res = await call(app, '/api/admin/reminders', json('PUT', { teams: { pumas: { to: ['Coach@Example.com'], cc: ['m@x.nz'] }, tigers: { to: [], cc: [] } } }));
    expect(res.status).toBe(200);
    const saved = await res.json<{ teams: ReminderTeam[] }>();
    expect(saved.teams[0]).toEqual({ slug: 'pumas', name: 'Parklands Pumas', to: ['coach@example.com'], cc: ['m@x.nz'] });

    const pub = (await (await call(app, '/api/teams')).text()) + (await (await call(app, '/api/games')).text());
    expect(pub).not.toContain('coach@example.com');
  });

  it('rejects bad lists and unknown teams without saving anything', async () => {
    const app = createApp(testDeps());
    const bad = await call(app, '/api/admin/reminders', json('PUT', { teams: { pumas: { to: ['ok@x.nz'], cc: [] }, tigers: { to: ['nope'], cc: [] } } }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ fields: { tigers: expect.stringContaining('nope') } });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM team_reminders').first('n')).toBe(0);

    const unknown = await call(app, '/api/admin/reminders', json('PUT', { teams: { lions: { to: [], cc: [] } } }));
    expect(unknown.status).toBe(400);
  });

  it('sends a test email to the saved lists', async () => {
    await saveContacts('pumas', ['coach@example.com'], ['m@x.nz']);
    const r = routes();
    const app = createApp(testDeps({ fetch: r.fetch }));
    const res = await call(app, '/api/admin/reminders/pumas/test', { method: 'POST', headers: ADMIN });
    expect(res.status).toBe(200);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].body).toMatchObject({ to: ['coach@example.com'], cc: ['m@x.nz'], subject: expect.stringMatching(/^\[Test\] Game-day report needed: Parklands Pumas v /) });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM reminder_log').first('n')).toBe(0); // a test doesn't count as the day's reminder
  });

  it('explains when a test email cannot be sent', async () => {
    const r = routes(() => Response.json({ message: 'The gameday@ domain is not verified' }, { status: 403 }));
    const app = createApp(testDeps({ fetch: r.fetch }));
    const none = await call(app, '/api/admin/reminders/tigers/test', { method: 'POST', headers: ADMIN });
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ message: 'Save at least one To address first.' });

    await saveContacts('pumas', ['coach@example.com']);
    const refused = await call(app, '/api/admin/reminders/pumas/test', { method: 'POST', headers: ADMIN });
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ message: expect.stringContaining('not verified') });

    const ctx = createExecutionContext();
    const off = await app.request('/api/admin/reminders/pumas/test', { method: 'POST', headers: ADMIN }, { ...env, RESEND_API_KEY: '' }, ctx);
    await waitOnExecutionContext(ctx);
    expect(off.status).toBe(503);
  });
});
