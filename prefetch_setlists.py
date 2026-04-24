"""
prefetch_setlists.py — Pre-fetch setlist.fm setlists for every concert and opener.

For each concert in data/concerts.json, this script fetches:
  1. The headliner's setlist (via the direct URL you've logged in the spreadsheet)
  2. Each opening act's setlist (via artist-name + date search on setlist.fm)

For festival rows, the "Opening Acts" column is really the day's lineup, so we
limit opener fetching to the top 5 acts (those are the ones you most likely
actually saw). For non-festival shows we fetch all listed openers.

All results cache to data/setlists.json. The app reads this file and displays
setlists in concert modals AND aggregates song-level stats across your entire
history.

Why at build time vs. runtime:
  - setlist.fm API requires an API key in a request header. Putting the key
    in browser-side code would expose it publicly.
  - GitHub Pages doesn't support server-side proxies.
  - Pre-fetching gives us a zero-dependency runtime + offline-capable static site.

Usage:
    # First-time setup: get an API key at https://www.setlist.fm/settings/api
    # Then store it in .secrets (one line, just the key) OR export SETLIST_FM_KEY.

    python3 prefetch_setlists.py                   # headliners + openers
    python3 prefetch_setlists.py --skip-openers    # headliners only (fast)
    python3 prefetch_setlists.py --refresh         # re-fetch everything
    python3 prefetch_setlists.py --limit 10        # smoke test

The script is polite:
  - Waits 1 second between requests by default (well under the 16/sec limit)
  - Retries up to 3 times on HTTP 429 / 5xx / network timeouts with exponential
    backoff (2s, 4s, 8s between retries)
  - Skips concerts/openers already cached (unless --refresh)
  - Saves cache incrementally every 10 requests so progress isn't lost
  - Opener-search misses are cached as errors so we don't re-hit them each run

Output: data/setlists.json, keyed by setlist ID (for headliners fetched by
URL) or by a compound key "opener:<artist-slug>:<YYYY-MM-DD>" (for openers
fetched by search). Each entry has:
    {
      "id": "...",
      "artist": "The Mars Volta",
      "tour": "...",
      "eventDate": "07-11-2004",
      "url": "https://www.setlist.fm/...",
      "sets": [
        { "name": null, "encore": null, "songs": [
            {"name": "Retrovertigo"},
            {"name": "Disco Volante", "cover": "John Zorn"},
            {"name": "...", "tape": true}
        ]},
        { "encore": 1, "songs": [...] }
      ],
      "role": "headliner" | "opener",   // added to help stats aggregation
      "info": "..."  // optional
    }
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


API_BASE = "https://api.setlist.fm/rest/1.0"


def load_api_key():
    """Look for the API key in env or a .secrets file."""
    key = os.environ.get("SETLIST_FM_KEY") or os.environ.get("SETLISTFM_API_KEY")
    if key:
        return key.strip()
    for candidate in (".secrets", ".setlistfm_key", "setlistfm.key"):
        if os.path.exists(candidate):
            with open(candidate) as f:
                line = f.readline().strip()
                if line:
                    return line
    return None


def extract_setlist_id(url):
    """Pull the 8-character hex ID from a setlist.fm URL."""
    if not url:
        return None
    # URLs look like: https://www.setlist.fm/setlist/artist/YYYY/venue-city-st-ID.html
    m = re.search(r"-([a-f0-9]{7,8})\.html", url)
    if m:
        return m.group(1)
    return None


def fetch_setlist(setlist_id, api_key, max_retries=3):
    """
    Call the setlist.fm API for a single setlist. Returns parsed JSON or {"_error": ...}.

    Retries on transient conditions (HTTP 429 rate-limit, socket timeouts, 5xx
    server errors) with exponential backoff. Does NOT retry on 404 or 403 since
    those mean the data genuinely isn't available and won't change by retrying.
    """
    url = f"{API_BASE}/setlist/{setlist_id}"
    req = urllib.request.Request(url, headers={
        "x-api-key": api_key,
        "Accept": "application/json",
        "User-Agent": "Sethlist/1.0 (personal concert archive)",
    })

    last_error = None
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last_error = f"HTTP {e.code}"
            # Retryable: 429 (rate limit), 502/503/504 (transient server issues)
            if e.code in (429, 502, 503, 504) and attempt < max_retries - 1:
                # Exponential backoff: 2s, 4s, 8s
                wait = 2 ** (attempt + 1)
                print(f"    (got HTTP {e.code}, waiting {wait}s before retry…)", flush=True)
                time.sleep(wait)
                continue
            # Not retryable (404, 403, etc.) — bail
            return {"_error": last_error}
        except (TimeoutError, OSError) as e:
            # Includes socket.timeout and connection errors
            last_error = f"{type(e).__name__}: {e}"
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    (timeout/network error, waiting {wait}s before retry…)", flush=True)
                time.sleep(wait)
                continue
            return {"_error": last_error}
        except Exception as e:
            # Unexpected error — don't retry
            return {"_error": f"{type(e).__name__}: {e}"}

    return {"_error": last_error or "unknown"}


# =========================================================================
# Opener handling: parse, search, cache-key
# =========================================================================

def split_acts(s):
    """
    Split an Opening Acts / festival-lineup string into individual band names.
    Mirrors the app's splitActs() in app.js: simple comma-separated format,
    parenthetical annotations stripped (e.g. "Live (co-headline)" -> "Live").
    """
    if not s:
        return []
    parts = re.split(r"[,;]", str(s))
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # Strip parenthetical notes like "(co-headline)"
        p = re.sub(r"\s*\([^)]*\)\s*", "", p).strip()
        if p:
            out.append(p)
    return out


def slugify_artist(name):
    """
    Normalize an artist name into a slug safe for use as a cache key.
    "The Mars Volta" -> "the-mars-volta", "Guns N' Roses" -> "guns-n-roses".
    """
    s = (name or "").lower()
    s = re.sub(r"[^\w\s-]", "", s)   # drop punctuation
    s = re.sub(r"\s+", "-", s).strip("-")
    return s


def opener_cache_key(artist, date_iso):
    """Build the cache key for an opener entry."""
    return f"opener:{slugify_artist(artist)}:{date_iso}"


def iso_to_setlistfm_date(iso):
    """Convert YYYY-MM-DD to DD-MM-YYYY (setlist.fm's expected format)."""
    if not iso or len(iso) < 10:
        return None
    y, m, d = iso[:4], iso[5:7], iso[8:10]
    return f"{d}-{m}-{y}"


def search_opener_setlist(artist_name, date_iso, api_key, max_retries=3):
    """
    Search setlist.fm for a setlist matching the given artist and date.
    Returns simplified dict (same shape as simplify()) or {"_error": "..."}
    or {"_error": "no match"} if search returned no results.
    """
    sfm_date = iso_to_setlistfm_date(date_iso)
    if not sfm_date:
        return {"_error": "bad date"}

    # Setlist.fm search is artistName + date; returns paginated results.
    params = urllib.parse.urlencode({
        "artistName": artist_name,
        "date": sfm_date,
        "p": "1",
    })
    url = f"{API_BASE}/search/setlists?{params}"
    req = urllib.request.Request(url, headers={
        "x-api-key": api_key,
        "Accept": "application/json",
        "User-Agent": "Sethlist/1.0 (personal concert archive)",
    })

    last_error = None
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
                break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # No setlists matched — that's a miss, not a retryable error
                return {"_error": "no match"}
            last_error = f"HTTP {e.code}"
            if e.code in (429, 502, 503, 504) and attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    (got HTTP {e.code}, waiting {wait}s before retry…)", flush=True)
                time.sleep(wait)
                continue
            return {"_error": last_error}
        except (TimeoutError, OSError) as e:
            last_error = f"{type(e).__name__}: {e}"
            if attempt < max_retries - 1:
                wait = 2 ** (attempt + 1)
                print(f"    (timeout, waiting {wait}s before retry…)", flush=True)
                time.sleep(wait)
                continue
            return {"_error": last_error}
        except Exception as e:
            return {"_error": f"{type(e).__name__}: {e}"}
    else:
        return {"_error": last_error or "unknown"}

    # Inspect results. The API returns {"setlist": [...]} with zero or more matches.
    results = data.get("setlist", []) or []
    if not results:
        return {"_error": "no match"}

    # Pick the best match:
    #   - Prefer results whose artist.name matches our query (case-insensitive)
    #   - Among those, prefer the one with the most songs (more complete)
    #   - Fallback to first result
    artist_lower = artist_name.lower()
    def artist_match_score(entry):
        name = ((entry.get("artist") or {}).get("name") or "").lower()
        if name == artist_lower:
            return 2
        # Some artists get registered with slight variations (e.g. "The X" vs "X")
        if name.replace("the ", "") == artist_lower.replace("the ", ""):
            return 1
        return 0

    def song_count(entry):
        sets = entry.get("sets", {}).get("set", []) or []
        return sum(len(s.get("song", []) or []) for s in sets)

    best = max(results, key=lambda r: (artist_match_score(r), song_count(r)))
    if artist_match_score(best) == 0:
        # Search returned results but none for this artist — treat as miss
        return {"_error": "no artist match"}
    if song_count(best) == 0:
        # Match found but empty setlist — technically a record, but no song data
        return {"_error": "empty setlist"}

    return simplify(best)


def simplify(raw):
    """Strip the API response down to the fields we actually need."""
    if not raw or raw.get("_error"):
        return raw
    sets = []
    for s in raw.get("sets", {}).get("set", []) or raw.get("set", []) or []:
        # API is inconsistent — some responses nest set under sets, others don't.
        songs = []
        for song in s.get("song", []) or []:
            entry = {"name": song.get("name", "")}
            if song.get("cover"):
                entry["cover"] = song["cover"].get("name", "")
            if song.get("with"):
                entry["with"] = song["with"].get("name", "")
            if song.get("tape"):
                entry["tape"] = True
            if song.get("info"):
                entry["info"] = song["info"]
            songs.append(entry)
        sets.append({
            "name": s.get("name") or None,
            "encore": s.get("encore") or None,
            "songs": songs,
        })
    return {
        "id": raw.get("id"),
        "artist": (raw.get("artist") or {}).get("name"),
        "tour": (raw.get("tour") or {}).get("name"),
        "eventDate": raw.get("eventDate"),
        "url": raw.get("url"),
        "sets": sets,
        "info": raw.get("info") or None,
    }


def main():
    parser = argparse.ArgumentParser(description="Prefetch setlist.fm data.")
    parser.add_argument("--concerts", default="data/concerts.json",
                        help="Path to concerts.json (default: data/concerts.json)")
    parser.add_argument("--out", default="data/setlists.json",
                        help="Output cache path")
    parser.add_argument("--refresh", action="store_true",
                        help="Re-fetch even if already cached")
    parser.add_argument("--limit", type=int, default=None,
                        help="Fetch only the first N headliners (for testing)")
    parser.add_argument("--pause", type=float, default=1.0,
                        help="Seconds to wait between requests (default: 1.0)")
    parser.add_argument("--skip-openers", action="store_true",
                        help="Only fetch headliners; don't search for opener setlists")
    parser.add_argument("--festival-top-n", type=int, default=5,
                        help="For festival days, only fetch top N acts' setlists (default: 5)")
    args = parser.parse_args()

    api_key = load_api_key()
    if not api_key:
        print("Error: no setlist.fm API key found.", file=sys.stderr)
        print("Get one at: https://www.setlist.fm/settings/api", file=sys.stderr)
        print("Then either:", file=sys.stderr)
        print("  export SETLIST_FM_KEY=your-key-here", file=sys.stderr)
        print("  OR write just the key to a file named .secrets", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.concerts):
        print(f"Error: {args.concerts} not found. Run build_data.py first.", file=sys.stderr)
        sys.exit(1)

    with open(args.concerts) as f:
        concerts = json.load(f)

    # Load cache
    cache = {}
    if os.path.exists(args.out):
        with open(args.out) as f:
            try:
                cache = json.load(f)
            except json.JSONDecodeError:
                print(f"Warning: {args.out} is malformed; starting fresh.")

    # ---------------------------------------------------------------
    # Phase 1: headliners (by URL)
    # ---------------------------------------------------------------
    headliner_work = []
    for c in concerts:
        sid = extract_setlist_id(c.get("setlistLink"))
        if not sid:
            continue
        if sid in cache and not cache[sid].get("_error") and not args.refresh:
            continue
        headliner_work.append((c, sid))

    if args.limit:
        headliner_work = headliner_work[:args.limit]

    # ---------------------------------------------------------------
    # Phase 2: openers (by search)
    # For festival rows, limit to top-N acts from the Opening Acts list.
    # Each entry: (concert, opener_artist, cache_key)
    # ---------------------------------------------------------------
    opener_work = []
    if not args.skip_openers:
        for c in concerts:
            acts = split_acts(c.get("openingActs") or "")
            if not acts:
                continue
            # Festival rows: limit to top N (these are the headliner-ish acts
            # that are most likely to have setlists AND that the user actually saw).
            if c.get("festivalKey"):
                acts = acts[:args.festival_top_n]
            date_iso = c.get("date")
            if not date_iso:
                continue
            for opener in acts:
                key = opener_cache_key(opener, date_iso)
                if key in cache and not cache[key].get("_error") and not args.refresh:
                    continue
                # If a previous run cached a definitive "no match" error, skip
                # it on subsequent runs unless --refresh — otherwise we'd
                # burn requests re-confirming misses forever.
                if key in cache and cache[key].get("_error") in ("no match", "no artist match", "empty setlist"):
                    if not args.refresh:
                        continue
                opener_work.append((c, opener, key))

    print(f"Concerts: {len(concerts)}")
    print(f"Already cached: {len(cache)}")
    print(f"Headliners to fetch: {len(headliner_work)}")
    print(f"Openers to search: {len(opener_work)}")
    print()

    successes = 0
    failures = []
    hits_count = 0
    miss_count = 0
    total = len(headliner_work) + len(opener_work)
    i = 0

    # ---- Headliners (direct URL fetches) ----
    for c, sid in headliner_work:
        i += 1
        prefix = f"[{i:>3}/{total}] H {sid} ({c.get('date', '?')} {c.get('artist', '?')[:35]})"
        raw = fetch_setlist(sid, api_key)
        if raw.get("_error"):
            print(f"{prefix} — FAILED ({raw['_error']})")
            failures.append((sid, c.get("artist"), raw["_error"]))
            cache[sid] = raw
        else:
            simple = simplify(raw)
            simple["role"] = "headliner"
            song_count = sum(len(s.get("songs", [])) for s in simple.get("sets", []))
            cache[sid] = simple
            successes += 1
            print(f"{prefix} — ok ({song_count} songs)")

        if i % 10 == 0 or i == total:
            with open(args.out, "w") as f:
                json.dump(cache, f, indent=2)
        time.sleep(args.pause)

    # ---- Openers (search by artist+date) ----
    for c, opener, key in opener_work:
        i += 1
        prefix = f"[{i:>3}/{total}] O      ({c.get('date', '?')} {opener[:35]})"
        result = search_opener_setlist(opener, c.get("date"), api_key)
        if result.get("_error"):
            # Expected misses (no match, no artist match, empty setlist) are
            # common for openers and not worth cluttering the "failures"
            # bucket with. Just count them.
            err = result["_error"]
            if err in ("no match", "no artist match", "empty setlist"):
                miss_count += 1
                print(f"{prefix} — miss ({err})")
            else:
                failures.append((key, opener, err))
                print(f"{prefix} — FAILED ({err})")
            cache[key] = result
        else:
            result["role"] = "opener"
            song_count = sum(len(s.get("songs", [])) for s in result.get("sets", []))
            cache[key] = result
            hits_count += 1
            successes += 1
            print(f"{prefix} — ok ({song_count} songs)")

        if i % 10 == 0 or i == total:
            with open(args.out, "w") as f:
                json.dump(cache, f, indent=2)
        time.sleep(args.pause)

    # Final save
    with open(args.out, "w") as f:
        json.dump(cache, f, indent=2)

    print()
    print(f"Downloaded: {successes}")
    if not args.skip_openers:
        print(f"  Opener hits: {hits_count}")
        print(f"  Opener misses: {miss_count}  (expected — many openers don't have setlists on setlist.fm)")
    print(f"Errors: {len(failures)}")
    if failures:
        print()
        print("Errors (not just misses — actual failures):")
        for key, artist, err in failures[:10]:
            print(f"  {key} ({artist}): {err}")
        print()
        print("Common causes:")
        print("  - HTTP 404 on headliner: setlist URL points to a different concert / has been reorganized")
        print("  - HTTP 403: API key invalid")
        print("  - HTTP 429: rate limit exceeded — wait and re-run (cached progress will resume)")


if __name__ == "__main__":
    main()
