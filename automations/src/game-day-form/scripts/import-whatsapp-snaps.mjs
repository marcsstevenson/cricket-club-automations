// Files photos and captions exported from the "Game Day Snaps" WhatsApp group into the
// Game Highlights folder, one subfolder per team, prefixed by the match date.
//
//   node scripts/import-whatsapp-snaps.mjs [export folder] [highlights folder]
//
// The export folder (default: your Downloads) holds what scripts/whatsapp-export.js saves
// from WhatsApp Web: gds_<hash>.jpg photos and gds_meta.json.
// Which team a poster belongs to comes from _whatsapp-senders.json in the highlights folder.
// The match date is the team's latest game on or before the day of the post (from the
// game-day database), so Sunday-morning posts land on Saturday's game.
//
// Safe to re-run: every image already anywhere in the highlights folder is fingerprinted,
// and a photo whose content is already there is never copied again, whatever its name.
// Message files are only rewritten when their text changes.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inDir = resolve(process.argv[2] ?? join(homedir(), 'Downloads'));
const outDir = resolve(
  process.argv[3] ??
    'C:/Users/marcs/Parklands Cricket Club Inc/PCC Committee - Documents/Community/Game Highlights',
);

const meta = JSON.parse(readFileSync(join(inDir, 'gds_meta.json'), 'utf8'));
const config = JSON.parse(readFileSync(join(outDir, '_whatsapp-senders.json'), 'utf8'));

// Team names from the squad list, game dates from production.
const squad = JSON.parse(readFileSync(join(projectDir, 'squad.json'), 'utf8'));
const teamName = new Map(squad.teams.map((t) => [t.slug, t.name]));
teamName.set('club', 'Club');
const out = execSync(
  'npx --no-install wrangler d1 execute pcc-game-day --remote --json --command "SELECT DISTINCT team_slug, game_date FROM reports"',
  { cwd: projectDir, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);
const gameDates = new Map();
for (const r of JSON.parse(out.slice(out.indexOf('[')))[0].results) {
  if (!gameDates.has(r.team_slug)) gameDates.set(r.team_slug, []);
  gameDates.get(r.team_slug).push(r.game_date);
}
const matchDate = (slug, posted) =>
  (gameDates.get(slug) ?? []).filter((d) => d <= posted).sort().pop() ?? posted;

// "d/m/yyyy" -> "yyyy-mm-dd"; weekday names count back from the export date.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const exported = new Date(meta.exportedAt ?? statSync(join(inDir, 'gds_meta.json')).mtime);
function isoDate(s) {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(exported);
  if (/^Yesterday/.test(s)) d.setDate(d.getDate() - 1);
  else if (WEEKDAYS.includes(s)) {
    do d.setDate(d.getDate() - 1);
    while (WEEKDAYS[d.getDay()] !== s);
  }
  return d.toLocaleDateString('en-CA');
}

const PHONE = /^\+\d[\d ]{6,}$/;
const TIME = /^\d{1,2}:\d{2}$/;
const NOISE = /joined from the community|was added|message history that starts|Click to share group history/;

// Chat messages: who posted, when, and what they wrote.
const posts = [];
let last = null;
for (const m of meta.captions) {
  if (NOISE.test(m.lines.join(' '))) continue;
  const lines = m.lines.filter((l) => !/^([A-Z]|\+\d+|\d+)$/.test(l));
  const phone = lines.find((l) => PHONE.test(l)) ?? null;
  const time = lines.find((l) => TIME.test(l)) ?? null;
  const name = lines[0] && !PHONE.test(lines[0]) && !TIME.test(lines[0]) ? lines[0].replace(/^~\s*/, '') : last?.name;
  const text = lines.filter((l, i) => i > 0 && !PHONE.test(l) && !TIME.test(l)).join('\n').trim();
  last = { name, phone: phone ?? last?.phone ?? null, date: isoDate(m.date), time, text };
  posts.push(last);
}

// The sender key WhatsApp shows in the photo viewer: a phone number, or a saved contact name.
const senderKey = (viewerName) => viewerName.trim();
const lookup = (key, date, time) =>
  config.overrides?.[`${date} ${time} ${key}`] ?? config.senders[key] ?? null;
const findPost = (key, date, time) =>
  posts.find((p) => p.date === date && p.time === time && (p.phone === key || p.name?.startsWith(key)));

// Fingerprint every image already filed, so nothing is copied twice. The _Unsorted folder
// doesn't count: once a sender is added to _whatsapp-senders.json, their photos move to the team.
const UNSORTED = '_Unsorted (WhatsApp)';
const unsortedDir = join(outDir, UNSORTED);
const have = new Set();
(function walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) p !== unsortedDir && walk(p);
    else if (/\.(jpe?g|png|heic|webp)$/i.test(e.name))
      have.add(createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16));
  }
})(outDir);

const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
const counts = { copied: 0, duplicate: 0, unsorted: 0, messages: 0 };
const messages = new Map(); // file -> { header, texts }

for (const [file, hdr] of Object.entries(meta.media)) {
  const src = join(inDir, file);
  if (!existsSync(src)) continue;
  const [who, when] = hdr.split('\n');
  const [, d, time] = when.match(/^(.*) at (\d{1,2}:\d{2})$/) ?? [];
  const posted = isoDate(d ?? when);
  const key = senderKey(who);
  const slug = lookup(key, posted, time);
  const post = findPost(key, posted, time);
  const sender = safe(post?.name ?? key);
  const team = slug ? teamName.get(slug) ?? slug : UNSORTED;
  const date = slug && slug !== 'club' ? matchDate(slug, posted) : posted;
  if (!slug) counts.unsorted++;
  const teamDir = join(outDir, safe(team));
  mkdirSync(teamDir, { recursive: true });

  const bytes = readFileSync(src);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  if (slug && existsSync(unsortedDir)) {
    for (const f of readdirSync(unsortedDir)) if (f.includes(` ${hash.slice(0, 8)}.`)) rmSync(join(unsortedDir, f));
  }
  if (have.has(hash)) counts.duplicate++;
  else if (!slug && existsSync(teamDir) && readdirSync(teamDir).some((f) => f.includes(` ${hash.slice(0, 8)}.`))) counts.duplicate++;
  else {
    copyFileSync(src, join(teamDir, `${date} WhatsApp ${sender} ${hash.slice(0, 8)}.jpg`));
    have.add(hash);
    counts.copied++;
  }

  if (post?.text) {
    const msgFile = join(teamDir, `${date} WhatsApp ${sender} message.txt`);
    const entry = messages.get(msgFile) ?? { header: `${sender}${post.phone ? ` (${post.phone})` : ''}, Game Day Snaps`, texts: new Map() };
    entry.texts.set(`${posted} ${time}`, post.text);
    messages.set(msgFile, entry);
  }
}

for (const [file, { header, texts }] of messages) {
  const body =
    [header, ...[...texts].sort().map(([at, t]) => `\r\n${at}\r\n${t.replace(/\r?\n/g, '\r\n')}`)].join('\r\n') + '\r\n';
  if (existsSync(file) && readFileSync(file, 'utf8') === body) continue;
  writeFileSync(file, body, 'utf8');
  counts.messages++;
}

console.log(
  `photos: ${counts.copied} copied, ${counts.duplicate} already there; ` +
    `${counts.unsorted} from unknown senders in _Unsorted (WhatsApp); ${counts.messages} message files written`,
);
