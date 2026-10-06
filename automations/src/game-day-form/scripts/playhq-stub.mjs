import { createServer } from 'node:http';

function nzDay(offsetDays) {
  const parts = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.now() + offsetDays * 864e5));
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const PUMAS = 'team-pumas';
const OPP = 'team-opp';
const game = (id, offset, opp, status, round) => ({
  id,
  status,
  round: { name: `Round ${round}`, abbreviatedName: `R${round}` },
  schedule: { date: nzDay(offset), time: '09:00:00', timezone: 'Pacific/Auckland' },
  venue: { name: 'Parklands Reserve' },
  competitors: [{ id: PUMAS, name: 'Parklands Pumas' }, { id: OPP, name: opp }],
});

const games = [
  game('e2e-g1', -14, 'Hornby Hawks', 'FINAL', 3),
  game('e2e-g2', -7, 'Syd Martin Scorchers', 'FINAL', 4),
  game('e2e-g3', 7, 'Riccarton Rams', 'PENDING', 5),
];

const st = (pairs) => pairs.map(([type, value]) => ({ type, value }));
const summary = (id, withStats) => ({
  id,
  status: 'FINAL',
  teams: [{ id: PUMAS, name: 'Parklands Pumas' }, { id: OPP, name: 'Opposition' }],
  appearances: withStats ? [{ id: 'ph-fill', firstName: 'Kim', lastName: 'Walker', teamId: PUMAS }] : [],
  periods: withStats
    ? [
        { name: 'FIRST_INNINGS', sequenceNo: 1, teams: [
          { id: OPP, discipline: 'BATTING', statistics: st([['TOTAL_SCORE', 128], ['TOTAL_OUTS', 4], ['OVER_LIMIT', 16]]), appearances: [] },
          { id: PUMAS, discipline: 'BOWLING', statistics: [], appearances: [{ id: 'ph-jordan', statistics: st([['WICKETS', 3], ['OVERS', 3]]) }] },
        ] },
        { name: 'FIRST_INNINGS', sequenceNo: 2, teams: [
          { id: PUMAS, discipline: 'BATTING', statistics: st([['TOTAL_SCORE', 145], ['TOTAL_OUTS', 4], ['OVER_LIMIT', 16]]),
            appearances: [{ id: 'ph-alex', statistics: st([['TOTAL_RUNS', 31], ['BALLS_FACED', 12]]) }, { id: 'ph-fill', statistics: st([['TOTAL_RUNS', 27]]) }] },
          { id: OPP, discipline: 'BOWLING', statistics: [], appearances: [] },
        ] },
      ]
    : [],
});

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (path === '/v1/grades/grade-y6/games') return send({ data: games, metadata: { hasMore: false, nextCursor: null } });
  const m = path.match(/^\/v2\/games\/(e2e-g[123])\/summary$/);
  if (m) return send({ data: summary(m[1], m[1] === 'e2e-g2') });
  res.writeHead(404).end();
}).listen(8790, '127.0.0.1', () => console.log('PlayHQ stub on http://127.0.0.1:8790'));
