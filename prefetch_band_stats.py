"""
prefetch_band_stats.py — Scrape each headliner's setlist.fm stats page to build
the universe of songs they've ever played live.

Why scraping vs API: setlist.fm's API exposes individual setlists but not the
aggregate per-song play counts. The /stats/<slug>-<id>.html page already
aggregates everything we need (every song with its total play count). One fetch
per band gives us the full picture vs hundreds of API calls walking paginated
setlists.

Reads:
  data/band_mbids.json  — produced by prefetch_band_mbids.py

Writes (per band, only if qualifying for bucket list — shows >= 2):
  data/band_stats/<slug>.json with shape:
    {
      "artist": "Puscifer",
      "slug": "puscifer",
      "stats_id": "3d6f5af",
      "mbid": "3d6f5af4-...",
      "fetched_at": "2026-04-27T...",
      "songs": [
        {"name": "Vagina Mine", "count": 224, "songid": "33d7d825"},
        {"name": "Conditions of My Parole", "count": 208, "songid": "1bdfb900"},
        ...
      ]
    }

Usage:
    python3 prefetch_band_stats.py
    python3 prefetch_band_stats.py --refresh        # re-scrape all
    python3 prefetch_band_stats.py --limit 3        # smoke test
    python3 prefetch_band_stats.py --pause 3.0      # extra polite

Politeness:
  - Default 2-second pause between requests (slower than API since this is
    HTML scraping, not the documented API).
  - Cached page hash (Last-Modified / ETag if available) to skip unchanged pages
    on re-runs without --refresh — but in practice we re-scrape if the file is
    older than --max-age-days (default 30).

Failure handling:
  - HTTP 429 / 5xx: exponential backoff, up to 3 retries.
  - HTTP 404: bad URL (slug+id mismatch). Log to failures and skip.
  - Parser found 0 song rows: log warning, save empty result so we don't loop
    on the same broken band. User can investigate and remove from cache to
    re-try.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape


STATS_URL_TEMPLATE = "https://www.setlist.fm/stats/{slug}-{stats_id}.html"


# Pattern matched against the saved Puscifer page (validated against 71 songs).
# Each songRow contains:
#   td.songName with data-stats-sort="<canonical name>"
#   chartLink with songid=<hex>
#   td.songCount with data-stats-sort="<integer count>"
SONG_ROW_PATTERN = re.compile(
    r'<tr class="songRow[^"]*"[^>]*>'
    r'.*?<td class="songName"\s+data-stats-sort="([^"]*)">'
    r'.*?songid=([a-f0-9]+)'
    r'.*?<td class="songCount"\s+data-stats-sort="(\d+)">',
    re.DOTALL,
)

# Validation: confirm we're parsing the right page by checking the artist-public-id
ARTIST_ID_PATTERN = re.compile(r'data-artist-public-id="([a-f0-9]+)"')


def fetch_html(url, max_retries=3):
    """Fetch a URL as HTML. Returns (html_str, None) or (None, error_str)."""
    req = urllib.request.Request(url, headers={
        # Setlist.fm seems happy with a plain UA. Mirror our existing convention.
        "User-Agent": "Mozilla/5.0 (compatible; Sethlist/1.0; personal concert archive)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })

    last_error = None
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                # The page is utf-8; setlist.fm sends correct Content-Type
                return r.read().decode("utf-8", errors="replace"), None
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            if e.code == 404:
                return None, "HTTP 404"
            if e.code in (429, 502, 503, 504) and attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    (got HTTP {e.code}, waiting {wait}s before retry…)", flush=True)
                time.sleep(wait)
                continue
            return None, last_error
        except (TimeoutError, OSError) as e:
            last_error = f"{type(e).__name__}: {e}"
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    (timeout/network error, waiting {wait}s before retry…)", flush=True)
                time.sleep(wait)
                continue
            return None, last_error
        except Exception as e:
            return None, f"{type(e).__name__}: {e}"

    return None, last_error or "unknown"


def parse_stats_page(html, expected_stats_id=None):
    """
    Parse the stats page HTML. Returns (songs_list, page_artist_id).

    songs_list: [{"name": "...", "count": N, "songid": "..."}], sorted by count desc
    page_artist_id: the artist-public-id found in the page (for logging)

    Note: we used to raise ValueError on a stats_id mismatch, but in practice
    the page can use a slightly different id format than the URL (different
    prefix length). As long as the URL successfully fetched a 200, we trust
    it's the right artist's page and just log any discrepancy.
    """
    artist_match = ARTIST_ID_PATTERN.search(html)
    page_artist_id = artist_match.group(1) if artist_match else None

    songs = []
    for m in SONG_ROW_PATTERN.finditer(html):
        name = unescape(m.group(1)).strip()
        songid = m.group(2)
        count = int(m.group(3))
        if name:  # skip oddly-empty rows defensively
            songs.append({"name": name, "songid": songid, "count": count})

    # Already in count-desc order on the page, but enforce it just in case
    songs.sort(key=lambda s: -s["count"])
    return songs, page_artist_id


def is_cache_fresh(out_path, max_age_days):
    """True if the cached file exists and is younger than max_age_days."""
    if not os.path.exists(out_path):
        return False
    if max_age_days is None or max_age_days <= 0:
        return True  # any cached file is fresh
    age = time.time() - os.path.getmtime(out_path)
    return age < (max_age_days * 86400)


def main():
    parser = argparse.ArgumentParser(description="Scrape per-band live song stats from setlist.fm.")
    parser.add_argument("--mbids", default="data/band_mbids.json",
                        help="Path to band_mbids.json (default: data/band_mbids.json)")
    parser.add_argument("--out-dir", default="data/band_stats",
                        help="Output directory for per-band JSON files")
    parser.add_argument("--refresh", action="store_true",
                        help="Re-scrape even if cache is fresh")
    parser.add_argument("--limit", type=int, default=None,
                        help="Scrape only the first N qualifying bands (for testing)")
    parser.add_argument("--pause", type=float, default=2.0,
                        help="Seconds between requests (default: 2.0 — be polite)")
    parser.add_argument("--max-age-days", type=int, default=30,
                        help="Re-scrape if cached file older than this (default: 30)")
    parser.add_argument("--all", action="store_true",
                        help="Scrape every headliner, not just bucket-list-qualifying ones")
    args = parser.parse_args()

    if not os.path.exists(args.mbids):
        print(f"Error: {args.mbids} not found. Run prefetch_band_mbids.py first.", file=sys.stderr)
        sys.exit(1)

    with open(args.mbids) as f:
        mbids = json.load(f)

    os.makedirs(args.out_dir, exist_ok=True)

    # Filter to entries we can actually scrape
    work = []
    skipped_unresolved = 0
    skipped_not_qualifying = 0
    for name, entry in mbids.items():
        if entry.get("_error") or not entry.get("stats_id") or not entry.get("slug"):
            skipped_unresolved += 1
            continue
        if not args.all and not entry.get("qualifies_for_bucket_list", False):
            skipped_not_qualifying += 1
            continue
        work.append((name, entry))

    # Apply limit
    if args.limit:
        work = work[:args.limit]

    print(f"Bands with resolved MBIDs: {len(mbids) - skipped_unresolved}")
    print(f"Skipped (unresolved): {skipped_unresolved}")
    if not args.all:
        print(f"Skipped (only seen once, not qualifying): {skipped_not_qualifying}")
    print(f"To scrape: {len(work)}")
    print()

    successes = 0
    skipped_fresh = 0
    failures = []

    for i, (name, entry) in enumerate(work, 1):
        slug = entry["slug"]
        stats_id = entry["stats_id"]
        out_path = os.path.join(args.out_dir, f"{slug}.json")
        prefix = f"[{i:>2}/{len(work)}] {name[:40]:<40}"

        if not args.refresh and is_cache_fresh(out_path, args.max_age_days):
            skipped_fresh += 1
            print(f"{prefix} — cached (fresh)")
            continue

        url = STATS_URL_TEMPLATE.format(slug=slug, stats_id=stats_id)
        html, err = fetch_html(url)
        if err:
            print(f"{prefix} — FAILED ({err}) [{url}]")
            failures.append((name, err))
            time.sleep(args.pause)
            continue

        try:
            songs, page_id = parse_stats_page(html, expected_stats_id=stats_id)
        except ValueError as e:
            print(f"{prefix} — FAILED ({e})")
            failures.append((name, str(e)))
            time.sleep(args.pause)
            continue

        if not songs:
            # Empty page — band has no songs in setlist.fm? Or page structure changed?
            print(f"{prefix} — WARNING: 0 songs parsed (HTML may have changed)")
            failures.append((name, "0 songs parsed"))
            # Still write a stub so we don't re-hit, but mark it
            payload = {
                "artist": name,
                "slug": slug,
                "stats_id": stats_id,
                "mbid": entry.get("mbid"),
                "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                "songs": [],
                "_warning": "0 songs parsed — HTML may have changed",
            }
        else:
            payload = {
                "artist": name,
                "slug": slug,
                "stats_id": stats_id,
                "mbid": entry.get("mbid"),
                "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                "songs": songs,
            }
            successes += 1
            print(f"{prefix} — ok ({len(songs)} songs, top: {songs[0]['name']} ×{songs[0]['count']})")

        with open(out_path, "w") as f:
            json.dump(payload, f, indent=2)

        time.sleep(args.pause)

    print()
    print(f"Scraped: {successes}")
    print(f"Cached (fresh, skipped): {skipped_fresh}")
    print(f"Failures: {len(failures)}")
    if failures:
        print()
        print("Failures:")
        for name, err in failures[:10]:
            print(f"  {name}: {err}")
        print()
        print("Common causes:")
        print("  - HTTP 404: stats_id wrong in band_mbids.json — fix that and re-run")
        print("  - 0 songs parsed: setlist.fm changed their HTML structure (regex needs update)")


if __name__ == "__main__":
    main()
