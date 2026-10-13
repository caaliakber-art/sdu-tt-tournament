#!/usr/bin/env python3
"""Convert the coordinator's Score_Card.xlsx into the JSON files the site reads.

Usage:  python scripts/update_scores.py [scores/Score_Card.xlsx] [data]

Reads the "Shuffled Matches" sheet (Day, Timing, Team 1, Team 2, Format,
Participant 1, Participant 2, Winner, Score, Winning Team) and writes:
  data/fixtures.json  events, rosters (who plays which event for which team), match list
  data/results.json   scores by match id, plus any warnings found while reading

Row order in the sheet is the match id (first match = 1), so keep rows in the
same order when adding scores. Blank score = not played yet.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

SHEET = "Shuffled Matches"
EVENT_KEYS = {
    "women's singles": ("WS", "Women's Singles"),
    "women's doubles": ("WD", "Women's Doubles"),
    "mixed doubles": ("XD", "Mixed Doubles"),
    "men's singles 1": ("MS1", "Men's Singles 1"),
    "men's singles 2": ("MS2", "Men's Singles 2"),
    "men's doubles 1": ("MD1", "Men's Doubles 1"),
    "men's doubles 2": ("MD2", "Men's Doubles 2"),
}
EVENT_ORDER = ["WS", "WD", "XD", "MS1", "MS2", "MD1", "MD2"]


def clean(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def team_no(v):
    m = re.search(r"(\d+)", clean(v))
    return int(m.group(1)) if m else None


def slot_code(v):
    t = clean(v).lower()
    if t.startswith("lunch"):
        return "L"
    if t.startswith("post"):
        return "P"
    return clean(v) or "?"


def event_of(v):
    t = clean(v).lower().replace("’", "'")
    if t in EVENT_KEYS:
        return EVENT_KEYS[t]
    key = re.sub(r"[^A-Z0-9]", "", clean(v).upper())[:4] or "EV"
    return key, clean(v)


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "scores/Score_Card.xlsx")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "data")
    out.mkdir(parents=True, exist_ok=True)

    wb = openpyxl.load_workbook(src, data_only=True)
    if SHEET not in wb.sheetnames:
        sys.exit(f'Sheet "{SHEET}" not found in {src}. Sheets: {wb.sheetnames}')
    ws = wb[SHEET]

    # Locate the header row and columns by name so extra columns do not break it.
    header_row, cols = None, {}
    for r in ws.iter_rows(min_row=1, max_row=10):
        names = [clean(c.value).lower() for c in r]
        if "day" in names and "format" in names:
            header_row = r[0].row
            for c, n in zip(r, names):
                cols[n] = c.column - 1
            break
    if header_row is None:
        sys.exit("Header row with Day and Format not found.")

    def col(*opts):
        for o in opts:
            for n, i in cols.items():
                if n.startswith(o):
                    return i
        return None

    c_day, c_time = col("day"), col("timing", "time", "slot")
    c_t1, c_t2 = col("team 1"), col("team 2")
    c_fmt = col("format")
    c_p1, c_p2 = col("participant 1"), col("participant 2")
    c_win, c_score, c_wteam = col("winner"), col("score"), col("winning team")

    events, roster, matches, results, warnings = {}, {}, [], {}, []
    mid = 0
    for row in ws.iter_rows(min_row=header_row + 1, values_only=True):
        if not clean(row[c_day]).lower().startswith("day"):
            continue
        mid += 1
        day = team_no(row[c_day])
        a, b = team_no(row[c_t1]), team_no(row[c_t2])
        key, name = event_of(row[c_fmt])
        events[key] = name
        p1, p2 = clean(row[c_p1]), clean(row[c_p2])
        for t, p in ((a, p1), (b, p2)):
            prev = roster.setdefault(key, {}).get(str(t))
            if prev and prev != p:
                warnings.append(f"Match {mid}: {name} Team {t} listed as '{p}' but earlier as '{prev}'.")
            roster[key].setdefault(str(t), p)
        matches.append({"id": mid, "day": day, "slot": slot_code(row[c_time]), "a": a, "b": b, "f": key})

        score = clean(row[c_score]) if c_score is not None else ""
        if not score:
            continue
        m = re.match(r"^(\d+)\s*[-–:]\s*(\d+)$", score)
        if not m:
            warnings.append(f"Match {mid} ({p1} v {p2}): score '{score}' not understood, skipped.")
            continue
        sa, sb = int(m.group(1)), int(m.group(2))
        if sa == sb:
            warnings.append(f"Match {mid} ({p1} v {p2}): tied score {score}, skipped.")
            continue
        hi, lo = max(sa, sb), min(sa, sb)
        if not ((hi == 21 and lo <= 19) or (lo >= 20 and hi == lo + 2)):
            warnings.append(f"Match {mid} ({p1} v {p2}): unusual score {score} for a game to 21, kept.")
        win_name = clean(row[c_win]) if c_win is not None else ""
        if win_name and win_name != (p1 if sa > sb else p2):
            warnings.append(f"Match {mid}: Winner column says '{win_name}' but score {score} says '{p1 if sa > sb else p2}'. Score used.")
        wt = team_no(row[c_wteam]) if c_wteam is not None else None
        if wt and wt != (a if sa > sb else b):
            warnings.append(f"Match {mid}: Winning Team column says Team {wt} but score {score} says Team {a if sa > sb else b}. Score used.")
        results[str(mid)] = [sa, sb]

    order = [k for k in EVENT_ORDER if k in events] + sorted(k for k in events if k not in EVENT_ORDER)
    fixtures = {
        "events": [{"k": k, "n": events[k]} for k in order],
        "roster": {k: dict(sorted(roster[k].items(), key=lambda kv: int(kv[0]))) for k in order},
        "matches": matches,
    }
    res = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": src.name,
        "played": len(results),
        "total": len(matches),
        "results": results,
        "warnings": warnings,
    }
    (out / "fixtures.json").write_text(json.dumps(fixtures, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (out / "results.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(matches)} matches, {len(results)} played, {len(warnings)} warning(s).")
    for w in warnings:
        print("  WARNING:", w)


if __name__ == "__main__":
    main()
