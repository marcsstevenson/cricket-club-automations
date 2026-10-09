"""Refresh the game-day squad JSON from the Team Formation workbook + PlayHQ.

Inputs (never committed, they hold full names):
  --dump    Team Formation workbook read via the Microsoft 365 connector (tab-separated text dump)
  --report  PlayHQ "Competition Participants Report" CSV (names -> Profile IDs)
  --squad   current squad.json (git-ignored, in automations/src/game-day-form)
  --env     automations/src/.env (PLAYHQ_API_KEY) - used to list this season's Parklands teams/grades
Writes --out only with --write. Prints a review summary (names appear only in this local output).

Rules: existing player keys never change; players are only removed by hand; a player moves team only on an
exact name match; new PlayHQ teams are added automatically; PlayHQ grade IDs are filled in once allocated.
"""
import argparse, collections, csv, difflib, json, re, urllib.request

ap = argparse.ArgumentParser()
for a in ('--dump', '--report', '--squad', '--env', '--out'):
    ap.add_argument(a, required=a != '--out')
ap.add_argument('--write', action='store_true')
args = ap.parse_args()

ORG = '73ce5541-a7ac-457a-a912-d6408aa96a74'
sq = json.load(open(args.squad, encoding='utf-8'))
season_name, season_id = sq['season']['name'], sq['season']['playhqSeasonId']

# --- PlayHQ: this season's Parklands teams (and grades once allocated) ---
env = dict(l.split('=', 1) for l in open(args.env, encoding='utf-8').read().splitlines() if re.match(r'^[A-Z_]+=', l))
key = env['PLAYHQ_API_KEY'].strip().strip('"\'')
phq, cursor = [], ''
while True:
    req = urllib.request.Request(f'https://api.playhq.com/v1/seasons/{season_id}/teams' + (f'?cursor={cursor}' if cursor else ''),
                                 headers={'x-api-key': key, 'x-phq-tenant': 'nzc'})
    j = json.load(urllib.request.urlopen(req))
    phq += [t for t in j['data'] if (t.get('club') or {}).get('id') == ORG]
    if not j.get('metadata', {}).get('hasMore'):
        break
    cursor = j['metadata']['nextCursor']

# --- PlayHQ report: registered players this season (name -> Profile ID) ---
pool = {}
for r in csv.DictReader(open(args.report, encoding='utf-8-sig', newline='')):
    if r['Season'] == season_name.replace(' (demo)', '') and r['Competition'] == 'CJCA Junior Cricket' \
            and r['Role'] == 'Player' and r['Status'] == 'Active':
        pool[r['Profile ID'].strip()] = (r['First Name'].strip(), r['Last Name'].strip(), r['Profile ID'].strip())
pool = list(pool.values())

# --- Team Formation sheet: header row of team names, then grade row, then coach/venue/player cells ---
lines = open(args.dump, encoding='utf-8').read().replace('\r', '').split('\n')
s = next(i for i, l in enumerate(lines) if l.startswith('## Sheet: Team Formation'))
e = next((i for i in range(s + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
g = [l.split('\t') for l in lines[s + 1:e]]
h = next(i for i, r in enumerate(g) if sum(1 for c in r if c.strip().upper().startswith(('BEARS', 'PUMAS', 'RHINOS'))) >= 2)
teamrow, graderow, prow = g[h], g[h + 1], g[h + 2:]

NICK = {'ollie': 'oliver', 'flo': 'florence', 'ed': 'edward', 'zack': 'zachary', 'zac': 'zachary', 'will': 'william',
        'mal': 'malachy', 'agya': 'agyajot', 'jessi': 'jessica', 'maddie': 'maddison', 'freddie': 'frederick',
        'tommy': 'thomas', 'sully': 'sullivan', 'lachie': 'lachlan', 'lachy': 'lachlan', 'auggie': 'august',
        'nate': 'nathaniel', 'max': 'maxwell', 'alex': 'alexander', 'poddy': 'padraig', 'ved': 'vedanth v',
        'eddie': 'edison', 'hugo': 'hugo henk'}
norm = lambda x: re.sub(r'[^a-z]', '', x.lower())


def clean(cell):
    c = re.sub(r'\(.*?\)|\[.*?\]', '', cell.strip())
    c = re.split(r'\s+-\s*|\s+-$|-\s+Y\d|\s-\s', c)[0]
    c = re.sub(r'\b(ML|QP|SB|SJ|SF|PV|NB|Y\d+|New)\b', '', c)
    return ' '.join(c.replace('-', ' - ').split()).replace(' - ', '-').strip(' -')


def match(name):
    w = name.split()
    if len(w) < 2:
        return None, 'one word'
    for k in range(1, len(w)):
        first, last = ' '.join(w[:k]), ' '.join(w[k:])
        cands = [p for p in pool if norm(p[1]) == norm(last)]
        exact = [p for p in cands if norm(p[0]) in (norm(first), norm(NICK.get(first.lower(), '#')))]
        if not exact and first.lower() == 'eddie':
            exact = [p for p in cands if p[0].lower() in ('edward', 'edison')]
        if len(exact) == 1:
            return exact[0], 'exact'
        if len(cands) == 1 and cands[0][0][:1].lower() == first[:1].lower():
            return cands[0], 'initial'
    best = max(pool, key=lambda p: difflib.SequenceMatcher(None, norm(name), norm(p[0] + p[1])).ratio())
    r = difflib.SequenceMatcher(None, norm(name), norm(best[0] + best[1])).ratio()
    return (best, f'fuzzy {r:.2f}') if r >= 0.85 else (None, 'nomatch')


def slug_of(name):
    t = name.split(' - ')[0].strip().lower()
    t = re.sub(r'^(parklands/nbcc|parklands)\s+', '', t)
    return {'ecscc/parklands korimako': 'korimako'}.get(t, t)


def gname(x):
    x = re.sub(r'^Y(\d+)$', r'Year \1', x.strip())
    return x.replace('Div 3 - Hardball', 'Division 3 (Hardball)').replace('Kiwi - ', 'Kiwi Cricket — ')


sheet, grades, review = collections.OrderedDict(), {}, []
first_swans = next((i for i, t in enumerate(teamrow) if t.strip() == 'Swans'), None)
for col in range(2, len(teamrow)):
    team = teamrow[col].strip()
    if not team or (team == 'Swans' and col != first_swans):  # second "Swans" column is a duplicate
        continue
    sl = slug_of(team)
    grades[sl] = graderow[col].strip() if col < len(graderow) else ''
    sheet.setdefault(sl, [])
    for r in prow:
        cell = r[col].strip() if col < len(r) else ''
        if cell.startswith(('Lost', 'Wants to join')):
            break  # everything below is not in the team
        if not cell or cell.startswith('Ask '):
            continue
        p, how = match(clean(cell))
        if p:
            sheet[sl].append((p, how))
            if how != 'exact':
                review.append(f'[{sl}] {cell!r} -> {p[0]} {p[1]} ({how})  <- check: coach/parent rows can match a child')
        elif how == 'nomatch' and len(cell.split()) >= 2 and not re.search(
                r'\d|Reserve|Domain|School|Wed|Thu|Mon|Tue|Fri|Sat|Yes|TBC|Grade|Need|Team Effort|Combined', cell):
            review.append(f'[{sl}] no PlayHQ match {cell!r}  <- coach/parent, or player not registered in PlayHQ yet')

teams = {t['slug']: t for t in sq['teams']}
by_id = {t['playhqTeamId']: t for t in sq['teams']}
changes = []

# New PlayHQ teams and grade allocations
for pt in phq:
    t = by_id.get(pt['id'])
    if not t:
        sl = slug_of(pt['name'])
        t = {'slug': sl, 'name': pt['name'], 'playhqTeamId': pt['id'], 'mascot': sl, 'players': []}
        if grades.get(sl):
            t['gradeName'] = gname(grades[sl])
        sq['teams'].append(t); teams[sl] = t; by_id[pt['id']] = t
        changes.append(f'NEW TEAM {pt["name"]} -> slug {sl}, grade {t.get("gradeName", "?")} (check a mascot image exists)')
    gid = (pt.get('grade') or {}).get('id')
    if gid and t.get('playhqGradeId') != gid:
        changes.append(f'GRADE {t["slug"]}: {t.get("playhqGradeId")} -> {gid} ({pt["grade"].get("name")})')
        t['playhqGradeId'] = gid
live = {pt['id'] for pt in phq}
for t in sq['teams']:
    if t['playhqTeamId'] not in live:
        changes.append(f'TEAM GONE FROM PLAYHQ: {t["slug"]} (left in place - remove by hand if intended)')
for sl in sheet:
    if sl not in teams:
        review.append(f'sheet column {sl!r} has no PlayHQ team - skipped')

# Players
where = {p['playhqId']: t['slug'] for t in sq['teams'] for p in t['players']}
keyof = {p['playhqId']: p['key'] for t in sq['teams'] for p in t['players']}
for sl, entries in sheet.items():
    if sl not in teams:
        continue
    for p, how in entries:
        src = where.get(p[2])
        if src == sl:
            continue
        if src:
            if how != 'exact':
                review.append(f'NOT MOVED {p[0]} {p[1]} {src} -> {sl} (non-exact match)')
                continue
            teams[src]['players'] = [x for x in teams[src]['players'] if x['playhqId'] != p[2]]
            changes.append(f'MOVED {p[0]} {p[1]}: {src} -> {sl}')
        else:
            changes.append(f'ADDED {p[0]} {p[1]} -> {sl} ({how})')
        teams[sl]['players'].append({'key': keyof.get(p[2], 'p' + p[2][:8]), 'firstName': p[0], 'lastName': p[1], 'playhqId': p[2]})
        where[p[2]] = sl
in_sheet = {p[2] for es in sheet.values() for p, _ in es}
for t in sq['teams']:
    for x in t['players']:
        if x['playhqId'] not in in_sheet:
            review.append(f'IN SQUAD, NOT IN SHEET: {x["firstName"]} {x["lastName"]} ({t["slug"]}) - kept; remove by hand only if they left')

for t in sq['teams']:
    t['players'].sort(key=lambda p: (p['firstName'].lower(), p['lastName'].lower()))
sq['teams'].sort(key=lambda t: t['slug'])
keys = [p['key'] for t in sq['teams'] for p in t['players']]
assert len(keys) == len(set(keys)), 'duplicate player keys'

print(f'PlayHQ: {len(phq)} Parklands teams, {sum(1 for t in phq if t.get("grade"))} with a grade; report players: {len(pool)}')
print('\nCHANGES:\n  ' + ('\n  '.join(changes) or '(none)'))
print('\nREVIEW:\n  ' + ('\n  '.join(review) or '(none)'))
print('\nCOUNTS:', {t['slug']: len(t['players']) for t in sq['teams']}, 'total', len(keys))
if args.write:
    json.dump(sq, open(args.out, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print('\nwritten', args.out)
