"""
download_drive_images.py — One-time bulk download of Google Drive poster images.

Reads data/poster_images.csv, finds every row with a Google Drive URL in
`personal_url`, downloads the image, and saves it to images/personal/poster-<id>.jpg.

Why this exists:
  Google Drive stopped reliably serving embedded <img> tags from other domains in
  2024. The thumbnail URLs still work for direct browser access, but not for
  hotlinking. This script sidesteps the whole problem by downloading the images
  once and serving them from your own repo.

What it does NOT do:
  - It won't overwrite existing files in images/personal/ unless you pass --force.
  - It won't touch images/official/ (you fill those in as you find stock URLs).
  - It doesn't modify poster_images.csv. The app still reads URLs from there; if
    a URL is present AND a local file exists, the local file wins on fallback.

Usage:
    python3 download_drive_images.py
    python3 download_drive_images.py --force           # re-download everything
    python3 download_drive_images.py --csv path/to/poster_images.csv

Requirements:
    No external dependencies — uses Python stdlib only.

Notes on Drive access:
    For this to work, each Drive file must be set to "Anyone with the link can view."
    If a file is restricted, the script will log it as failed and skip to the next.
    Drive may rate-limit bulk requests — the script inserts a 0.5s pause between
    downloads. If you hit a 429, wait a few minutes and re-run with --force.
"""

import argparse
import csv
import os
import re
import sys
import time
import urllib.request
import urllib.error


def extract_drive_id(url):
    """Pull the file ID out of any Drive URL variant we might encounter."""
    if not url:
        return None
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", url)
    if m:
        return m.group(1)
    return None


def download_drive_image(file_id, out_path, timeout=20):
    """
    Download a Drive image to the given path.
    Uses the thumbnail URL at size w2000 (large enough to look good on hi-DPI
    displays, small enough to keep the repo reasonable). Returns True on success.
    """
    url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w2000"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Sethlist/1.0)",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            # Drive sometimes redirects through a consent/scan page when the
            # content-type isn't image/*. Detect and skip those.
            ctype = response.headers.get("Content-Type", "")
            if not ctype.startswith("image/"):
                return False, f"wrong content-type: {ctype}"
            data = response.read()
            if len(data) < 1000:
                return False, f"suspiciously small response ({len(data)} bytes)"
            with open(out_path, "wb") as f:
                f.write(data)
            return True, f"{len(data) // 1024} KB"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except urllib.error.URLError as e:
        return False, f"URL error: {e.reason}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def main():
    parser = argparse.ArgumentParser(description="Download Drive poster images locally.")
    parser.add_argument("--csv", default="data/poster_images.csv",
                        help="Path to poster_images.csv (default: data/poster_images.csv)")
    parser.add_argument("--out", default="images/personal",
                        help="Output directory (default: images/personal)")
    parser.add_argument("--force", action="store_true",
                        help="Re-download even if a local file exists")
    parser.add_argument("--pause", type=float, default=0.5,
                        help="Seconds to wait between downloads (default: 0.5)")
    args = parser.parse_args()

    if not os.path.exists(args.csv):
        print(f"Error: {args.csv} not found.", file=sys.stderr)
        print("Run build_data.py first to generate it.", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.out, exist_ok=True)

    # Read the CSV
    rows = []
    with open(args.csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append(row)

    drive_rows = []
    for row in rows:
        url = (row.get("personal_url") or "").strip()
        drive_id = extract_drive_id(url)
        if drive_id:
            drive_rows.append((row, drive_id))

    print(f"Found {len(rows)} total poster rows, {len(drive_rows)} with Drive URLs.")
    if not drive_rows:
        print("Nothing to download.")
        return

    print()
    success = []
    skipped = []
    failed = []

    for i, (row, file_id) in enumerate(drive_rows, 1):
        poster_id = row["poster_id"]
        artist = row.get("artist", "?")
        date = row.get("date", "?")
        out_path = os.path.join(args.out, f"poster-{poster_id}.jpg")

        prefix = f"[{i:>3}/{len(drive_rows)}] poster-{poster_id:>3} ({date} {artist})"

        if os.path.exists(out_path) and not args.force:
            print(f"{prefix} — skip (exists)")
            skipped.append(row)
            continue

        ok, info = download_drive_image(file_id, out_path)
        if ok:
            print(f"{prefix} — ok ({info})")
            success.append(row)
        else:
            print(f"{prefix} — FAILED ({info})")
            failed.append((row, info))

        time.sleep(args.pause)

    # Summary
    print()
    print("=" * 50)
    print(f"Downloaded:  {len(success)}")
    print(f"Skipped:     {len(skipped)}  (use --force to re-download)")
    print(f"Failed:      {len(failed)}")

    if failed:
        print()
        print("Failures (first 10):")
        for row, reason in failed[:10]:
            print(f"  poster-{row['poster_id']} {row.get('artist', '?')}: {reason}")
        print()
        print("Common causes:")
        print("  - Drive file isn't shared 'Anyone with the link can view'")
        print("  - Rate limiting — wait a few minutes and re-run with --force")
        print("  - File deleted or moved in Drive")

    print()
    print(f"Images saved to: {args.out}/")
    print("Commit these to your repo — the app will pick them up automatically.")


if __name__ == "__main__":
    main()
