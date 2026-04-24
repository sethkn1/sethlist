"""
prefetch_setlists.py — Pre-fetch setlist.fm setlists for every concert.

Reads data/concerts.json, pulls out the setlist.fm URL for each show that has
one, extracts the setlist ID, and calls the setlist.fm API to get the full
setlist (songs in order). Caches results to data/setlists.json so the app
can render them inline without any runtime API calls.

Why at build time vs. runtime:
  - setlist.fm API requires an API key in a request header. Putting the key
    in browser-side code would expose it publicly.
  - GitHub Pages doesn't support server-side proxies.
  - Pre-fetching gives us a zero-dependency runtime + offline-capable static site.

Usage:
    # First-time setup: get an API key at https://www.setlist.fm/settings/api
    # Then store it in .secrets (one line, just the key) OR export SETLIST_FM_KEY.

    python3 prefetch_setlists.py

    python3 prefetch_setlists.py --refresh     # re-fetch everything, even cached
    python3 prefetch_setlists.py --limit 10    # only fetch first 10 (smoke test)

The script is polite:
  - Waits 1 second between requests by default (well under the 16/sec limit)
  - Retries up to 3 times on HTTP 429 / 5xx / network timeouts with exponential
    backoff (2s, 4s, 8s between retries)
  - Skips concerts already in the cache (unless --refresh)
  - Saves cache incrementally every 10 requests so progress isn't lost
  - Override pacing with --pause SECONDS (e.g. --pause 0.5 for faster fetches)

Output: data/setlists.json, keyed by setlist ID:
    {
      "73db568d": {
        "id": "73db568d",
        "artist": "Mr. Bungle",
        "tour": "California Tour",
        "eventDate": "07-11-1999",
        "sets": [
          { "name": null, "encore": null, "songs": [
              {"name": "Retrovertigo"},
              {"name": "Disco Volante", "cover": "John Zorn"},
              {"name": "...", "tape": true}
          ]},
          { "encore": 1, "songs": [...] }
        ],
        "info": "..."  // optional
      },
      ...
    }
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
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
                        help="Fetch only the first N (for testing)")
    parser.add_argument("--pause", type=float, default=1.0,
                        help="Seconds to wait between requests (default: 1.0)")
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

    # Collect work
    work = []
    for c in concerts:
        sid = extract_setlist_id(c.get("setlistLink"))
        if not sid:
            continue
        if sid in cache and not cache[sid].get("_error") and not args.refresh:
            continue
        work.append((c, sid))

    if args.limit:
        work = work[:args.limit]

    print(f"Concerts: {len(concerts)}")
    print(f"Already cached: {len(cache)}")
    print(f"To fetch: {len(work)}")
    print()

    successes = 0
    failures = []
    for i, (c, sid) in enumerate(work, 1):
        prefix = f"[{i:>3}/{len(work)}] {sid} ({c.get('date', '?')} {c.get('artist', '?')[:35]})"
        raw = fetch_setlist(sid, api_key)
        if raw.get("_error"):
            print(f"{prefix} — FAILED ({raw['_error']})")
            failures.append((sid, c.get("artist"), raw["_error"]))
            cache[sid] = raw  # cache the error so we don't retry every run
        else:
            simple = simplify(raw)
            song_count = sum(len(s.get("songs", [])) for s in simple.get("sets", []))
            cache[sid] = simple
            successes += 1
            print(f"{prefix} — ok ({song_count} songs)")

        # Save incrementally so we don't lose progress if killed
        if i % 10 == 0 or i == len(work):
            with open(args.out, "w") as f:
                json.dump(cache, f, indent=2)

        time.sleep(args.pause)

    # Final save
    with open(args.out, "w") as f:
        json.dump(cache, f, indent=2)

    print()
    print(f"Downloaded: {successes}")
    print(f"Failed: {len(failures)}")
    if failures:
        print()
        print("Failures:")
        for sid, artist, err in failures[:10]:
            print(f"  {sid} ({artist}): {err}")
        print()
        print("Common causes:")
        print("  - HTTP 404: setlist URL points to a different concert / has been reorganized")
        print("  - HTTP 403: API key invalid or rate-limited")
        print("  - HTTP 429: rate limit exceeded — wait and re-run (cached progress will resume)")


if __name__ == "__main__":
    main()
