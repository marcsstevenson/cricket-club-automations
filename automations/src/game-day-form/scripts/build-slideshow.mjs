// Builds a self-running club-night slideshow from the Game Highlights folder.
//
//   node scripts/build-slideshow.mjs ["Club Night 2026.11.21"] [highlights folder]
//
// Writes "<title>.html" (plus a _slideshow folder of mascots and the logo) into
// the highlights folder. Open it in Chrome and press F for full screen. Photos stay where they
// are and are linked by relative path, so copy the whole Game Highlights folder if the show
// runs on another computer. Re-run after new photos arrive; nothing else needs changing.
//
// Keys: F full screen, Space pause, arrows back/forward. ?secs=8 in the URL changes photo time.
// Phone numbers never appear on screen.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const title = process.argv[2] ?? 'Club Night 2026.11.21';
const outDir = resolve(
  process.argv[3] ??
    'C:/Users/marcs/Parklands Cricket Club Inc/PCC Committee - Documents/Community/Game Highlights',
);
const assetDir = join(outDir, '_slideshow');
mkdirSync(assetDir, { recursive: true });

const squad = JSON.parse(readFileSync(join(projectDir, 'squad.json'), 'utf8'));
const safe = (s) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim();
const byFolder = new Map(squad.teams.map((t) => [safe(t.name), t]));

copyFileSync(join(projectDir, 'web/static/brand/pcc-logo-horizontal-dark.svg'), join(assetDir, 'logo.svg'));

const PHONE = /^\+\d[\d ]{6,}$/;
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();

// Game-day highlights file: "Team, date" / optional "Score: x v y" / blank / text.
function gameDayText(p) {
  const lines = read(p).split('\n');
  const score = lines[1]?.startsWith('Score:') ? lines[1].slice(7).trim() : null;
  const text = lines.slice(score ? 2 : 1).join('\n').trim();
  return text ? { who: null, score, text } : null;
}

// WhatsApp message file: "Name (phone), Game Day Snaps", then blocks of "date time" / text.
function whatsappTexts(p) {
  const [head, ...blocks] = read(p).split(/\n\n/);
  const who = head.replace(/\s*\(.*\)/, '').replace(/, Game Day Snaps$/, '').trim();
  return blocks
    .map((b) => {
      let lines = b.split('\n').slice(1).filter((l) => !PHONE.test(l.trim()));
      // WhatsApp shows a poster's profile label ("Wolves", "Lemurs Manager") above the caption.
      if (lines.length && /^[\w ]{1,20}$/.test(lines[0]) && lines[0].trim().split(' ').length <= 2) {
        if (lines.length > 1 || /manager/i.test(lines[0])) lines = lines.slice(1);
      }
      return lines.join('\n').trim();
    })
    .filter(Boolean)
    .map((text) => ({ who: PHONE.test(who) ? null : who, score: null, text }));
}

const teams = [];
for (const e of readdirSync(outDir, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name.startsWith('_')) continue;
  const team = byFolder.get(e.name);
  const slug = team?.slug ?? (e.name === 'Club' ? 'club' : null);
  let mascot = null;
  const mascotSrc = team && join(projectDir, 'web/static/mascots', `${team.mascot ?? team.slug}.webp`);
  if (mascotSrc && existsSync(mascotSrc)) {
    copyFileSync(mascotSrc, join(assetDir, `${team.slug}.webp`));
    mascot = `_slideshow/${team.slug}.webp`;
  }

  const dates = new Map();
  const day = (d) => {
    if (!dates.has(d)) dates.set(d, { date: d, texts: [], photos: [], captions: new Map() });
    return dates.get(d);
  };
  const files = readdirSync(join(outDir, e.name)).sort();
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2}) (.*)$/);
    if (!m) continue;
    const p = join(outDir, e.name, f);
    if (/ highlights\.txt$/.test(f)) {
      const t = gameDayText(p);
      if (t) day(m[1]).texts.unshift(t);
    } else if (/^WhatsApp .* message\.txt$/.test(m[2])) {
      const who = m[2].replace(/^WhatsApp /, '').replace(/ message\.txt$/, '');
      const ts = whatsappTexts(p);
      day(m[1]).texts.push(...ts);
      day(m[1]).captions.set(who, ts.map((t) => t.text).join(' '));
    }
  }
  for (const f of files) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2}) (.*)\.(jpe?g|png|webp)$/i);
    if (!m) continue;
    const wa = m[2].match(/^WhatsApp (.*) [0-9a-f]{8}$/);
    const who = wa ? wa[1] : null;
    const d = day(m[1]);
    d.photos.push({
      src: `${encodeURIComponent(e.name)}/${encodeURIComponent(f)}`,
      who: who && !PHONE.test(who) ? who : null,
      caption: (who && d.captions.get(who)) || null,
    });
  }
  const list = [...dates.values()]
    .filter((d) => d.photos.length || d.texts.length)
    .map(({ captions, ...d }) => d);
  if (list.length)
    teams.push({ slug, name: slug === 'club' ? 'Parklands Cricket Club' : e.name, grade: team?.gradeName ?? null, mascot, dates: list });
}

const photoCount = teams.reduce((n, t) => n + t.dates.reduce((m, d) => m + d.photos.length, 0), 0);
const data = { title, season: squad.season?.name ?? '', built: new Date().toISOString(), teams };

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { --teal: #40beb3; --ink: #0b1416; --text: #f4f7f7; --muted: #a9bcbd; }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; background: var(--ink); color: var(--text); overflow: hidden;
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif; cursor: none; }
  .slide { position: fixed; inset: 0; opacity: 0; transition: opacity 1.2s ease; display: grid; place-items: center; }
  .slide.on { opacity: 1; }
  .bg { position: absolute; inset: -5%; background-size: cover; background-position: center; filter: blur(40px) brightness(.45); }
  .photo { position: relative; max-width: 100vw; max-height: 100vh; object-fit: contain; animation: drift 14s ease-out both; }
  @keyframes drift { from { transform: scale(1); } to { transform: scale(1.06); } }
  .bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 4vh 4vw 3.5vh;
    background: linear-gradient(transparent, rgba(5,10,11,.88) 45%); display: flex; gap: 2.5vw; align-items: flex-end; }
  .bar img { height: 11vh; width: 11vh; object-fit: contain; flex: none; border-radius: 1.6vh; }
  .bar .team { font-size: 4.2vh; font-weight: 700; line-height: 1.1; }
  .bar .meta { font-size: 2.5vh; color: var(--teal); font-weight: 600; margin-top: .4vh; letter-spacing: .02em; }
  .bar .cap { font-size: 2.6vh; color: var(--text); margin-top: 1vh; max-width: 70vw; line-height: 1.35;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .card { width: min(1500px, 88vw); display: grid; grid-template-columns: auto 1fr; gap: 5vw; align-items: center; }
  .card .mascot { height: 46vh; width: 46vh; object-fit: contain; border-radius: 4vh; filter: drop-shadow(0 2vh 4vh rgba(0,0,0,.5)); }
  .card .mascot.logo { width: 60vh; height: auto; }
  .kicker { color: var(--teal); font-size: 2.6vh; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .card h1 { font-size: 9vh; line-height: 1.02; margin: 1.5vh 0; font-weight: 800; }
  .card h2 { font-size: 3.4vh; color: var(--muted); font-weight: 500; }
  .score { display: inline-block; margin-top: 2.5vh; padding: .8vh 2vh; border: .3vh solid var(--teal); border-radius: 99px;
    font-size: 3vh; font-weight: 700; color: var(--teal); }
  .quotes { margin-top: 3vh; display: grid; gap: 2.4vh; max-height: 52vh; overflow: hidden; }
  .quotes p { font-size: 3.3vh; line-height: 1.4; white-space: pre-line; }
  .quotes .who { display: block; font-size: 2.3vh; color: var(--muted); margin-top: .6vh; }
  .intro { text-align: center; }
  .intro img { width: min(70vw, 900px); }
  .intro h1 { font-size: 10vh; margin-top: 5vh; font-weight: 800; }
  .intro p { font-size: 3.4vh; color: var(--muted); margin-top: 2vh; }
  #hud { position: fixed; top: 2vh; right: 2vw; font-size: 2vh; color: var(--muted); opacity: 0; transition: opacity .4s; }
  #hud.show { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .photo { animation: none; } .slide { transition: none; } }
</style>
</head>
<body>
<div id="stage"></div>
<div id="hud"></div>
<script>
const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const SECS = Number(new URLSearchParams(location.search).get('secs')) || 6;
const stage = document.getElementById('stage');
const hud = document.getElementById('hud');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const photoTotal = DATA.teams.reduce((n, t) => n + t.dates.reduce((m, d) => m + d.photos.length, 0), 0);

function buildDeck() {
  const deck = [{ kind: 'intro', secs: 8 }];
  for (const team of shuffle([...DATA.teams])) {
    deck.push({ kind: 'team', team, secs: 5 });
    for (const day of team.dates) {
      if (day.texts.length) {
        const words = day.texts.reduce((n, t) => n + t.text.split(/\\s+/).length, 0);
        deck.push({ kind: 'text', team, day, secs: Math.min(20, 7 + words / 4) });
      }
      for (const photo of day.photos) deck.push({ kind: 'photo', team, day, photo, secs: SECS });
    }
  }
  return deck;
}

function render(s) {
  const t = s.team;
  const mascot = t && (t.mascot ? '<img class="mascot" src="' + t.mascot + '" alt="">' : '<img class="mascot logo" src="_slideshow/logo.svg" alt="">');
  if (s.kind === 'intro') return '<div class="intro"><img src="_slideshow/logo.svg" alt="Parklands Cricket Club"><h1>' + esc(DATA.title) + '</h1><p>Game Day Highlights &middot; ' +
    esc(DATA.season) + ' &middot; ' + DATA.teams.length + ' teams &middot; ' + photoTotal + ' photos</p></div>';
  if (s.kind === 'team') return '<div class="card">' + mascot + '<div><div class="kicker">Next up</div><h1>' + esc(t.name) + '</h1>' +
    (t.grade ? '<h2>' + esc(t.grade) + '</h2>' : '') + '</div></div>';
  if (s.kind === 'text') {
    const score = s.day.texts.find((x) => x.score)?.score;
    return '<div class="card">' + mascot + '<div><div class="kicker">' + esc(fmt(s.day.date)) + '</div><h1>' + esc(t.name) + '</h1>' +
      (score ? '<span class="score">' + esc(score.replace(' v ', ' &nbsp;v&nbsp; ')).replace(/&amp;nbsp;/g, '&nbsp;') + '</span>' : '') +
      '<div class="quotes">' + s.day.texts.map((x) => '<p>' + esc(x.text) + (x.who ? '<span class="who">&mdash; ' + esc(x.who) + '</span>' : '') + '</p>').join('') +
      '</div></div></div>';
  }
  const p = s.photo;
  return '<div class="bg" style="background-image:url(&quot;' + p.src + '&quot;)"></div><img class="photo" src="' + p.src + '" alt="">' +
    '<div class="bar">' + (t.mascot ? '<img src="' + t.mascot + '" alt="">' : '') + '<div><div class="team">' + esc(t.name) + '</div>' +
    '<div class="meta">' + esc(fmt(s.day.date)) + (p.who ? ' &middot; photo by ' + esc(p.who) : '') + '</div>' +
    (p.caption ? '<div class="cap">' + esc(p.caption) + '</div>' : '') + '</div></div>';
}

let deck = buildDeck(), i = -1, timer = null, paused = false, current = null;
function preload(n) { const s = deck[n]; if (s && s.kind === 'photo') new Image().src = s.photo.src; }
function show(n) {
  if (n >= deck.length) { deck = buildDeck(); n = 0; }
  if (n < 0) n = deck.length - 1;
  i = n;
  const el = document.createElement('div');
  el.className = 'slide';
  el.innerHTML = render(deck[i]);
  stage.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  const old = current; current = el;
  if (old) { old.classList.remove('on'); setTimeout(() => old.remove(), 1400); }
  preload(i + 1); preload(i + 2);
  clearTimeout(timer);
  if (!paused) timer = setTimeout(() => show(i + 1), deck[i].secs * 1000);
}
function flash(msg) { hud.textContent = msg; hud.classList.add('show'); clearTimeout(flash.t); flash.t = setTimeout(() => hud.classList.remove('show'), 1500); }
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(i + 1);
  else if (e.key === 'ArrowLeft') show(i - 1);
  else if (e.key === ' ') { paused = !paused; flash(paused ? 'Paused' : 'Playing'); show(i); }
  else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  else return;
  e.preventDefault();
});
document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
show(0);
</script>
</body>
</html>
`;

writeFileSync(join(outDir, `${title}.html`), html, 'utf8');
console.log(`Slideshow: ${teams.length} teams, ${photoCount} photos -> ${join(outDir, `${title}.html`)}`);
