"""Build shared/src/gear-data.json from the PCC gear workbook and the game-day team list.

Usage:
  python scripts/import_gear.py --workbook "<path to PCC Gear List 2026-27 Season - v7.xlsx>"
      [--teams-sheet "Oct Gear check"] [--teams-url https://gameday.parklandscricket.co.nz/api/teams]
      [--out shared/src/gear-data.json]

Needs openpyxl. See docs/spec.md §2 for the rules.
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

import openpyxl

EXCLUDED_CATEGORIES = {"Senior kit", "Misc", "Other safety"}

# Oct Gear check grade -> (Kit Spec column, display grade)
GRADES = {
    "kiwi - year 1": ("Kiwi Y1", "Kiwi Year 1"),
    "kiwi - year 1/2": ("Kiwi Y1", "Kiwi Year 1/2"),  # Kiwi Y1 and Y2 carry the same kit
    "kiwi - year 2": ("Kiwi Y2", "Kiwi Year 2"),
    "year 3": ("Year 3", "Year 3"),
    "year 4": ("Year 4", "Year 4"),
    "year 5": ("Year 5", "Year 5"),
    "y6": ("Year 6", "Year 6"),
    "y7": ("Year 7", "Year 7"),
    "division 5": ("Div 5", "Division 5"),
    "division 4": ("Div 4", "Division 4"),
    "div 3 - hardball": ("Div 3 Hardball", "Division 3 Hardball"),
}

DEFAULT_TEAMS_URL = "https://gameday.parklandscricket.co.nz/api/teams"


def fail(msg: str):
    sys.exit(f"import_gear: {msg}")


def text(v) -> str:
    return "" if v is None else str(v).strip()


def header_row(rows, first: str) -> int:
    for i, r in enumerate(rows):
        if r and text(r[0]) == first:
            return i
    fail(f"no header row starting {first!r}")


def read_catalogue(ws):
    rows = list(ws.iter_rows(values_only=True))
    h = header_row(rows, "Item ID")
    cols = [text(c) for c in rows[h]]
    ci, cc, cn = cols.index("Item ID"), cols.index("Category"), cols.index("Item")
    items = []
    for r in rows[h + 1 :]:
        item_id = text(r[ci])
        if not item_id:
            continue
        cat = text(r[cc])
        if cat in EXCLUDED_CATEGORIES:
            continue
        items.append({"id": item_id, "category": cat, "name": text(r[cn])})
    return items


def read_kit_spec(ws, catalogue_ids):
    rows = list(ws.iter_rows(values_only=True))
    h = header_row(rows, "Item ID")
    cols = [text(c) for c in rows[h]]
    grade_cols = {name: i for i, name in enumerate(cols) if i >= 3 and name}
    specs = {g: {} for g in grade_cols}
    for r in rows[h + 1 :]:
        item_id = text(r[0])
        if item_id not in catalogue_ids:
            continue
        for g, i in grade_cols.items():
            v = r[i] if i < len(r) else None
            if isinstance(v, (int, float)) and v > 0:
                specs[g][item_id] = int(v)
    return specs


def read_team_sheet(ws):
    rows = list(ws.iter_rows(values_only=True))
    h = header_row(rows, "Team")
    cols = [text(c) for c in rows[h]]
    cg, cd = cols.index("Grade"), cols.index("Dot colour")
    out = {}
    for r in rows[h + 1 :]:
        name, grade = text(r[0]), text(r[cg])
        if not name or not grade:
            continue
        key = re.split(r"[\s-]+", name.lower())[0]
        dot = text(r[cd]).lower() or None
        out[key] = {"sheetName": name, "grade": grade, "dot": dot}
    return out


def fetch_teams(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "pcc-gear-counter-import"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def build(workbook: str, teams_sheet: str, teams):
    wb = openpyxl.load_workbook(workbook, data_only=True, read_only=True)
    for name in ("Items", "Kit Spec", teams_sheet):
        if name not in wb.sheetnames:
            fail(f"workbook has no {name!r} sheet")
    items = read_catalogue(wb["Items"])
    specs = read_kit_spec(wb["Kit Spec"], {i["id"] for i in items})
    sheet = read_team_sheet(wb[teams_sheet])

    out_teams, used = [], set()
    for t in teams:
        row = sheet.get(t["slug"])
        if not row:
            fail(f"team {t['slug']} is not on the {teams_sheet!r} sheet")
        g = GRADES.get(row["grade"].lower())
        if not g:
            fail(f"unknown grade {row['grade']!r} for {row['sheetName']}")
        spec_col, display = g
        if not specs.get(spec_col):
            fail(f"Kit Spec has no quantities for {spec_col!r}")
        used.add(spec_col)
        out_teams.append(
            {"slug": t["slug"], "name": t["name"], "mascot": t.get("mascot") or t["slug"], "grade": display, "spec": spec_col, "dot": row["dot"]}
        )

    categories = list(dict.fromkeys(i["category"] for i in items))
    return {
        "source": f"{Path(workbook).name} — Items, Kit Spec, {teams_sheet}",
        "categories": categories,
        "items": items,
        "specs": {g: specs[g] for g in specs if g in used},
        "teams": out_teams,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workbook", required=True)
    ap.add_argument("--teams-sheet", default="Oct Gear check")
    ap.add_argument("--teams-url", default=DEFAULT_TEAMS_URL)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "shared/src/gear-data.json"))
    a = ap.parse_args()
    data = build(a.workbook, a.teams_sheet, fetch_teams(a.teams_url))
    Path(a.out).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(data['teams'])} teams, {len(data['items'])} items, specs: {', '.join(data['specs'])} -> {a.out}")


if __name__ == "__main__":
    main()
