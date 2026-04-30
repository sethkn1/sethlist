"""
scrub_poster_images.py — One-time cleanup for data/poster_images.csv.

Re-derives every personal_url and stock_url from the xlsx hyperlinks, ignoring
whatever's currently in the CSV. Use this once to recover from the
cross-attachment bug where adding new poster rows to the spreadsheet caused
existing posters' URLs to migrate to wrong ids.

After running this, also delete and re-download the local image files since
some of them are misnamed copies from before the row shift:

    python3 scrub_poster_images.py
    rm -rf images/personal images/stock
    python3 download_drive_images.py

Why a separate script: build_data.py's normal flow preserves CSV values when
xlsx is empty, to support manual URL pastes. That preservation behavior is the
exact thing that perpetuates contamination. This script bypasses it by writing
a CSV directly from xlsx, then exits.

If you have any URLs in poster_images.csv that aren't in the xlsx (manual
pastes), they will be lost. As of this writing, every URL in the CSV maps to
an xlsx hyperlink, so there's nothing to lose — but if you ever paste a URL
manually outside the xlsx, run this BEFORE the manual paste, not after.
"""

import sys
import csv
import re
from pathlib import Path
from openpyxl import load_workbook

# Reuse build_data.py's xlsx-loading + drive-thumbnail logic.
sys.path.insert(0, str(Path(__file__).parent))
from build_data import load_posters, to_drive_thumbnail


def main():
    posters_xlsx = "Poster Collection.xlsx"
    csv_path = "data/poster_images.csv"

    if not Path(posters_xlsx).exists():
        print(f"ERROR: {posters_xlsx} not found in current directory.")
        sys.exit(1)

    posters, personal_urls, stock_urls = load_posters(posters_xlsx)
    print(f"Loaded {len(posters)} posters from {posters_xlsx}")

    # Count what we're writing
    n_personal = sum(1 for u in personal_urls if u)
    n_stock = sum(1 for u in stock_urls if u)
    print(f"  {n_personal} personal URLs from xlsx hyperlinks")
    print(f"  {n_stock} stock URLs from xlsx hyperlinks")

    rows = []
    for p, personal, stock in zip(posters, personal_urls, stock_urls):
        rows.append({
            "poster_id": p["id"],
            "date": p["date"] or "",
            "artist": p["artist"] or "",
            "location": p.get("location") or "",
            "type": p.get("type") or "",
            "variant": p.get("variant") or "",
            "number": p.get("number") or "",
            "personal_url": personal or "",
            "stock_url": stock or "",
            "official_url": "",
        })

    # Backup the existing CSV first
    if Path(csv_path).exists():
        backup = csv_path + ".backup"
        Path(csv_path).rename(backup)
        print(f"  Backed up existing CSV to {backup}")

    Path("data").mkdir(exist_ok=True)
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["poster_id", "date", "artist", "location",
                        "type", "variant", "number",
                        "personal_url", "stock_url", "official_url"]
        )
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
    print(f"  Wrote fresh {csv_path}")
    print()
    print("Next steps:")
    print("  1. Verify the CSV looks right (spot-check a few rows)")
    print("  2. Delete and re-download local images:")
    print("       rm -rf images/personal images/stock")
    print("       python3 download_drive_images.py")
    print("  3. Run a normal build to regenerate posters.json:")
    print("       python3 build_data.py 'Concert History.xlsx' 'Poster Collection.xlsx' --skip-wiki")
    print("  4. Test locally, then commit and push.")


if __name__ == "__main__":
    main()
