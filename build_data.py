"""
Build the app's data files from your spreadsheets.

Usage:
    python3 build_data.py <concerts_source> <posters_source>

Sources can be .xlsx or .csv files:
    python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx"
    python3 build_data.py data/concerts.csv data/posters.csv

This script does three things:
    1. Generates data/concerts.json from your concert source
    2. Generates data/posters.json from your poster source
    3. Extracts personal-photo URLs (from the "Link to Photo" column hyperlinks)
       and writes them to data/poster_images.csv, converting Google Drive
       file URLs to direct-embed thumbnail URLs.

On re-runs, data/poster_images.csv is preserved and merged with any new images
from the source — so manual edits to URLs won't be lost.

Requirements:
    pip install pandas openpyxl
"""

import sys
import re
import json
import csv
import os
from pathlib import Path
import pandas as pd
from openpyxl import load_workbook


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def clean(v):
    """Normalize a cell value: NaN→None, strip strings, leave numbers alone."""
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    if isinstance(v, (int, float, bool)):
        return v
    s = str(v).strip()
    return s if s else None


def to_drive_thumbnail(url):
    """
    Convert a Google Drive 'view' URL to a directly-embeddable thumbnail URL.
    Handles these input forms:
        https://drive.google.com/file/d/FILE_ID/view?usp=drive_link
        https://drive.google.com/open?id=FILE_ID
        https://drive.google.com/uc?id=FILE_ID
    Returns: https://drive.google.com/thumbnail?id=FILE_ID&sz=w1000
    Non-Drive URLs are returned unchanged.
    """
    if not url or "drive.google.com" not in url:
        return url
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", url)
    if m:
        return f"https://drive.google.com/thumbnail?id={m.group(1)}&sz=w1000"
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    if m:
        return f"https://drive.google.com/thumbnail?id={m.group(1)}&sz=w1000"
    return url


def parse_date(v):
    """Parse an arbitrary date value to YYYY-MM-DD string (or None)."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    try:
        d = pd.to_datetime(v)
        return d.strftime("%Y-%m-%d")
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Source loaders: xlsx vs csv
# ---------------------------------------------------------------------------

def load_concerts(path):
    ext = Path(path).suffix.lower()
    if ext in (".xlsx", ".xlsm"):
        all_sheets = pd.read_excel(path, sheet_name=None)
        for name, df in all_sheets.items():
            if "Headlining Artist" in df.columns or "Artist" in df.columns:
                return _concerts_from_df(df)
        raise ValueError(f"No concert sheet found in {path}")
    elif ext == ".csv":
        df = pd.read_csv(path)
        return _concerts_from_df(df)
    raise ValueError(f"Unsupported file type: {ext}")


def _concerts_from_df(df):
    col = lambda *names: next((n for n in names if n in df.columns), None)
    date_c = col("Date", "date")
    df = df.dropna(subset=[date_c]).copy() if date_c else df.copy()
    if date_c:
        df = df.sort_values(date_c).reset_index(drop=True)

    out = []
    for i, row in df.iterrows():
        date = row.get(date_c) if date_c else None
        date_str = parse_date(date)
        out.append({
            "id": int(i),
            "date": date_str,
            "year": int(pd.to_datetime(date).year) if date_str else None,
            "dayOfWeek": clean(row.get(col("Day of Week", "dayOfWeek"))),
            "artist": clean(row.get(col("Headlining Artist", "Artist", "artist"))),
            "city": clean(row.get(col("City", "city"))),
            "state": clean(row.get(col("State", "state"))),
            "venue": clean(row.get(col("Venue", "venue"))),
            "attendedWith": clean(row.get(col("Attended With", "attendedWith"))),
            "hasPoster": clean(row.get(col("Have Poster", "hasPoster"))) in ("Yes", "yes", True, 1, "1"),
            "setlistLink": clean(row.get(col("Setlist.FM Link", "setlistLink"))),
            "tourName": clean(row.get(col("Tour Name", "tourName"))),
            "openingActs": clean(row.get(col("Opening Acts", "openingActs"))),
            "notes": clean(row.get(col("Notes", "notes"))),
        })
    return out


def load_posters(path):
    ext = Path(path).suffix.lower()
    if ext in (".xlsx", ".xlsm"):
        return _posters_from_xlsx(path)
    elif ext == ".csv":
        df = pd.read_csv(path)
        return _posters_from_df(df, personal_urls=[])
    raise ValueError(f"Unsupported file type: {ext}")


def _posters_from_xlsx(path):
    all_sheets = pd.read_excel(path, sheet_name=None)
    sheet_name = None
    for candidate in ("Poster List", "Concert Posters", "Posters"):
        if candidate in all_sheets:
            sheet_name = candidate
            break
    if not sheet_name:
        sheet_name = list(all_sheets.keys())[0]
    df = all_sheets[sheet_name]

    wb = load_workbook(path, data_only=False)
    ws = wb[sheet_name]
    headers = [c.value for c in ws[1]]

    photo_col_idx = None
    for name in ("Link to Photo", "Link to Photos", "Photo", "Image URL"):
        if name in headers:
            photo_col_idx = headers.index(name) + 1
            break

    eb_col_idx = None
    for name in ("Expressobeans Poster Link", "Expressobeans"):
        if name in headers:
            eb_col_idx = headers.index(name) + 1
            break

    personal_urls = []
    expressobeans_urls = []
    for row_idx in range(2, ws.max_row + 1):
        if photo_col_idx:
            cell = ws.cell(row=row_idx, column=photo_col_idx)
            url = cell.hyperlink.target if cell.hyperlink else None
            personal_urls.append(to_drive_thumbnail(url) if url else None)
        else:
            personal_urls.append(None)
        if eb_col_idx:
            cell = ws.cell(row=row_idx, column=eb_col_idx)
            url = (cell.hyperlink.target if cell.hyperlink else cell.value)
            expressobeans_urls.append(url if url and str(url).startswith("http") else None)
        else:
            expressobeans_urls.append(None)

    return _posters_from_df(df, personal_urls, expressobeans_urls)


def _posters_from_df(df, personal_urls, expressobeans_urls=None):
    col = lambda *names: next((n for n in names if n in df.columns), None)
    date_c = col("Date", "date")
    df = df.dropna(subset=[date_c]).copy() if date_c else df.copy()

    n = len(df)
    if len(personal_urls) < n:
        personal_urls = list(personal_urls) + [None] * (n - len(personal_urls))
    if expressobeans_urls is None:
        expressobeans_urls = [None] * n
    elif len(expressobeans_urls) < n:
        expressobeans_urls = list(expressobeans_urls) + [None] * (n - len(expressobeans_urls))

    out = []
    for i, (_, row) in enumerate(df.iterrows()):
        date = row.get(date_c) if date_c else None
        date_str = parse_date(date)
        eb = expressobeans_urls[i] if i < len(expressobeans_urls) else None
        if not eb:
            eb = clean(row.get(col("Expressobeans Poster Link", "expressobeansLink")))
        out.append({
            "id": int(i),
            "date": date_str,
            "year": int(pd.to_datetime(date).year) if date_str else None,
            "artist": clean(row.get(col("Artist", "artist"))),
            "illustrator": clean(row.get(col("Artist/Illustrator", "illustrator"))),
            "location": clean(row.get(col("Location", "location"))),
            "type": clean(row.get(col("Type", "type"))),
            "number": clean(row.get(col("Number", "number"))),
            "tourShowSpecific": clean(row.get(col("Tour/Show Specific", "tourShowSpecific"))),
            "autographed": clean(row.get(col("Autographed", "autographed"))) in ("Yes", "yes", True, 1, "1"),
            "framed": clean(row.get(col("Framed", "framed"))) in ("Yes", "yes", True, 1, "1"),
            "attended": clean(row.get(col("Attended", "attended"))) in ("Yes", "yes", True, 1, "1"),
            "expressobeansLink": eb,
        })
    return out, personal_urls


# ---------------------------------------------------------------------------
# poster_images.csv: merge new URLs with existing user edits
# ---------------------------------------------------------------------------

def merge_poster_images(csv_path, posters, personal_urls):
    """
    Read existing poster_images.csv if present. Merge in any newly-discovered
    personal URLs from the source spreadsheet. Preserve any user-edited URLs
    already in the CSV (personal or official).

    CSV columns: poster_id, date, artist, personal_url, official_url
    """
    existing = {}
    if os.path.exists(csv_path):
        with open(csv_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    existing[int(row["poster_id"])] = row
                except (ValueError, KeyError):
                    continue

    rows = []
    for p, personal in zip(posters, personal_urls):
        pid = p["id"]
        prev = existing.get(pid, {})
        personal_url = prev.get("personal_url") or personal or ""
        official_url = prev.get("official_url") or ""
        rows.append({
            "poster_id": pid,
            "date": p["date"] or "",
            "artist": p["artist"] or "",
            "personal_url": personal_url,
            "official_url": official_url,
        })

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["poster_id", "date", "artist", "personal_url", "official_url"],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    return rows


# ---------------------------------------------------------------------------
# CSV mirrors (for hand-editing concerts + posters)
# ---------------------------------------------------------------------------

def write_concerts_csv(path, concerts):
    fields = [
        "id", "date", "dayOfWeek", "artist", "city", "state", "venue",
        "attendedWith", "hasPoster", "setlistLink", "tourName",
        "openingActs", "notes",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for c in concerts:
            row = {k: c.get(k, "") for k in fields}
            if row["hasPoster"] is True: row["hasPoster"] = "Yes"
            elif row["hasPoster"] is False: row["hasPoster"] = "No"
            for k, v in row.items():
                if v is None: row[k] = ""
            writer.writerow(row)


def write_posters_csv(path, posters):
    fields = [
        "id", "date", "artist", "illustrator", "location", "type", "number",
        "tourShowSpecific", "autographed", "framed", "attended",
        "expressobeansLink",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for p in posters:
            row = {k: p.get(k, "") for k in fields}
            for k in ("autographed", "framed", "attended"):
                if row[k] is True: row[k] = "Yes"
                elif row[k] is False: row[k] = "No"
            for k, v in row.items():
                if v is None: row[k] = ""
            writer.writerow(row)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build(concerts_src, posters_src, out_dir="data"):
    Path(out_dir).mkdir(exist_ok=True)

    concerts = load_concerts(concerts_src)
    posters, personal_urls = load_posters(posters_src)

    with open(f"{out_dir}/concerts.json", "w") as f:
        json.dump(concerts, f, indent=2)
    with open(f"{out_dir}/posters.json", "w") as f:
        json.dump(posters, f, indent=2)

    write_concerts_csv(f"{out_dir}/concerts.csv", concerts)
    write_posters_csv(f"{out_dir}/posters.csv", posters)

    csv_rows = merge_poster_images(f"{out_dir}/poster_images.csv", posters, personal_urls)
    with_personal = sum(1 for r in csv_rows if r["personal_url"])
    with_official = sum(1 for r in csv_rows if r["official_url"])

    print(f"Wrote {len(concerts)} concerts, {len(posters)} posters to {out_dir}/")
    print(f"poster_images.csv: {with_personal} personal URLs, {with_official} official URLs")
    print()
    print("You can also edit these CSVs directly (then re-run this script):")
    print(f"  - {out_dir}/concerts.csv (add/edit/delete concerts)")
    print(f"  - {out_dir}/posters.csv (add/edit/delete posters)")
    print(f"  - {out_dir}/poster_images.csv (paste in official image URLs)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    build(sys.argv[1], sys.argv[2])
