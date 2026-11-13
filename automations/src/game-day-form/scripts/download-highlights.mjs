// Downloads every game's highlights text and photos from production into a folder per team.
//
//   node scripts/download-highlights.mjs [output folder]
//
// Default output: the committee SharePoint "Community\Game Highlights" folder on Marc's PC.
// Files are named by match date, e.g.
//   Parklands Bears\2026-11-07 Parklands Bears highlights.txt
//   Parklands Bears\2026-11-07 photo 0b1c352a.jpg
// Safe to re-run: a photo already on disk is skipped (its name comes from the photo's
// own id, so it never gets a second copy), and a highlights file is only rewritten
// when the text in the app has changed since the last run.
// Needs wrangler signed in to the club's Cloudflare account (`npx wrangler login`).

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(here, '..');
const outDir = resolve(
  process.argv[2] ??
    'C:/Users/marcs/Parklands Cricket Club Inc/PCC Committee - Documents/Community/Game Highlights',
);
const DB = 'pcc-game-day';
const BUCKET = 'pcc-game-day-photos';

function wrangler(args) {
  // Run through the shell so Windows finds npx.cmd; every argument here is ours, not user input.
  const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  return execSync(`npx --no-install wrangler ${quoted.join(' ')}`, {
    cwd: projectDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
}

function query(sql) {
  const out = wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', sql.replace(/\s+/g, ' ').trim()]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

// Team display names from the squad list; a team missing from it keeps its slug.
const teamNames = new Map();
try {
  const squad = JSON.parse(readFileSync(join(projectDir, 'squad.json'), 'utf8'));
  for (const t of squad.teams ?? []) teamNames.set(t.slug, t.name);
} catch {}
const teamName = (slug) => teamNames.get(slug) ?? slug;
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();

const reports = query(`
  SELECT r.id, r.team_slug, r.game_date, r.highlights,
         r.team_runs, r.team_wkts, r.opp_runs, r.opp_wkts
  FROM reports r
  WHERE (r.highlights IS NOT NULL AND trim(r.highlights) <> '')
     OR EXISTS (SELECT 1 FROM photos p WHERE p.report_id = r.id)
  ORDER BY r.game_date, r.team_slug`);
const photos = query(`
  SELECT p.id, p.report_id, p.r2_key FROM photos p
  JOIN reports r ON r.id = p.report_id
  ORDER BY p.created_at`);

const counts = { textNew: 0, textUpdated: 0, textSame: 0, photoNew: 0, photoSkipped: 0, photoFailed: 0 };

for (const r of reports) {
  const name = teamName(r.team_slug);
  const teamDir = join(outDir, safe(name));
  mkdirSync(teamDir, { recursive: true });

  const text = (r.highlights ?? '').trim();
  if (text) {
    const score = (runs, wkts) => (runs == null ? null : wkts == null ? `${runs}` : `${runs}/${wkts}`);
    const us = score(r.team_runs, r.team_wkts);
    const them = score(r.opp_runs, r.opp_wkts);
    const lines = [`${name}, ${r.game_date}`];
    if (us || them) lines.push(`Score: ${us ?? '?'} v ${them ?? '?'}`);
    const body = `${lines.join('\r\n')}\r\n\r\n${text.replace(/\r?\n/g, '\r\n')}\r\n`;
    const file = join(teamDir, `${r.game_date} ${safe(name)} highlights.txt`);
    const old = existsSync(file) ? readFileSync(file, 'utf8') : null;
    if (old === body) counts.textSame++;
    else {
      writeFileSync(file, body, 'utf8');
      old === null ? counts.textNew++ : counts.textUpdated++;
    }
  }

  for (const p of photos.filter((x) => x.report_id === r.id)) {
    const ext = (p.r2_key.match(/\.[a-z0-9]+$/i)?.[0] ?? '.jpg').toLowerCase();
    const file = join(teamDir, `${r.game_date} photo ${p.id.slice(0, 8)}${ext}`);
    if (existsSync(file)) {
      counts.photoSkipped++;
      continue;
    }
    const part = `${file}.part`;
    try {
      wrangler(['r2', 'object', 'get', `${BUCKET}/${p.r2_key}`, '--remote', '--file', part]);
      renameSync(part, file);
      counts.photoNew++;
      console.log(`downloaded ${name} ${r.game_date} ${p.id.slice(0, 8)}`);
    } catch (e) {
      rmSync(part, { force: true });
      counts.photoFailed++;
      console.error(`could not download ${p.r2_key}: ${e.message.split('\n')[0]}`);
    }
  }
}

console.log(`\n${reports.length} games with highlights or photos -> ${outDir}`);
console.log(
  `highlights: ${counts.textNew} new, ${counts.textUpdated} updated, ${counts.textSame} unchanged; ` +
    `photos: ${counts.photoNew} new, ${counts.photoSkipped} already there, ${counts.photoFailed} failed`,
);
process.exitCode = counts.photoFailed ? 1 : 0;
