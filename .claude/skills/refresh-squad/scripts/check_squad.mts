// Validate a squad file with the app's own parser and confirm no label shows a full surname.
// Run from automations/src/game-day-form: npx tsx ../../../.claude/skills/refresh-squad/scripts/check_squad.mts squad.json
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const app = process.cwd();
const { parseSquad } = await import(pathToFileURL(resolve(app, 'api/src/squad/load.ts')).href);
const { squadLabels } = await import(pathToFileURL(resolve(app, 'shared/src/labels.ts')).href);

const s = parseSquad(JSON.parse(readFileSync(process.argv[2] ?? 'squad.json', 'utf8')));
let n = 0;
let bad = 0;
for (const t of s.teams) {
  const labels: Map<string, string> = squadLabels(t.players);
  n += labels.size;
  for (const [k, v] of labels) {
    const p = t.players.find((p: { key: string }) => p.key === k)!;
    if (p.lastName.length > 1 && v.toLowerCase().includes(p.lastName.toLowerCase())) bad++;
  }
}
console.log(`valid; teams ${s.teams.length}, labels ${n}, full-surname labels ${bad}`);
if (bad) process.exit(1);
