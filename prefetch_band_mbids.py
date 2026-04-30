"""
prefetch_band_mbids.py — Resolve setlist.fm artist MBIDs for every headliner.

For each unique headliner in data/setlists.json, this script calls setlist.fm's
/search/artists endpoint to find that band's MusicBrainz ID. The MBID is
required to build the band's stats-page URL (e.g.,
https://www.setlist.fm/stats/puscifer-3d6f5af.html — that "3d6f5af" is the first
7 hex chars of the MBID).

Why we need this separately:
  - prefetch_setlists.py's simplify() drops artist.mbid from the API response,
    so the cached setlists don't carry it. This script does a small, targeted
    set of API calls (~62 for Seth's collection, one-time) to fill the gap.
  - We don't want to invalidate the existing setlists cache by re-fetching
    everything just to pick up one field.

Disambiguation strategy (for common artist names like "Live"):
  1. Call /search/artists?artistName=<name>
  2. Score candidates by:
     - Exact name match (case-insensitive) → strong signal
     - sortName match → tiebreaker
     - URL slug matches the slug already seen in your existing setlist URLs
       (extracted from data/setlists.json). This is the strongest signal
       because it confirms the artist matches the one whose setlists you've
       already cached.
  3. If the top-scoring candidate is unambiguous, save it. If multiple
     candidates tie or the slug doesn't match, log to overrides_needed and
     ask the user to manually pick in data/band_mbids_overrides.json.

Usage:
    # Same .secrets / SETLIST_FM_KEY env var as prefetch_setlists.py
    python3 prefetch_band_mbids.py
    python3 prefetch_band_mbids.py --refresh        # re-resolve everything
    python3 prefetch_band_mbids.py --limit 5        # smoke test

Output: data/band_mbids.json — keyed by artist name. Each entry:
    {
      "Puscifer": {
        "mbid": "3d6f5af4-7c7e-4a40-9c64-f0892ed8a3a6",
        "stats_id": "3d6f5af",         # 7-char prefix used in stats URL
        "slug": "puscifer",            # URL slug from setlist.fm
        "shows_attended": 5,
        "qualifies_for_bucket_list": true   # shows >= 2
      },
      ...
    }

Conflicts are written to data/band_mbids_overrides.json with candidates listed,
for the user to manually edit and re-run.
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
# Threshold for inclusion in the cross-band "bucket list" view. Set to 1
# so that every headliner you've ever seen contributes to the unheard-songs
# list — the bucket list shows the full catalog of unheard songs across
# all of those bands. The renderBucketList() UI in app.js exposes a
# "≥ 2 shows" filter chip for the narrower "bands I see often" view.
BUCKET_LIST_THRESHOLD = 1


def load_api_key():
    """Look for the API key in env or a .secrets file. Same as prefetch_setlists.py."""
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


def search_artist(artist_name, api_key, max_retries=3):
    """
    Call /search/artists for the given name. Returns parsed JSON or {"_error": ...}.
    Same retry/backoff pattern as prefetch_setlists.py.
    """
    params = urllib.parse.urlencode({
        "artistName": artist_name,
        "p": "1",
        "sort": "relevance",
    })
    url = f"{API_BASE}/search/artists?{params}"
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
            if e.code == 404:
                return {"_error": "no match"}
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
                print(f"    (timeout/network error, waiting {wait}s before retry…)", flush=True)
                time.sleep(wait)
                continue
            return {"_error": last_error}
        except Exception as e:
            return {"_error": f"{type(e).__name__}: {e}"}

    return {"_error": last_error or "unknown"}


def extract_slug_from_url(setlist_url):
    """
    From a setlist.fm setlist URL like
    https://www.setlist.fm/setlist/puscifer/2024/.../-aabbccdd.html
    extract the artist slug ("puscifer").
    """
    if not setlist_url:
        return None
    m = re.search(r"/setlist/([^/]+)/", setlist_url)
    return m.group(1) if m else None


def collect_headliners(setlists):
    """
    From data/setlists.json, build {artist_name: {"shows_attended": N, "known_slug": "..."}}.
    Includes festivals (per design — festival appearances count as shows seen).
    """
    out = {}
    for k, v in setlists.items():
        if not isinstance(v, dict):
            continue
        if v.get("role") != "headliner":
            continue
        if v.get("_error"):
            continue
        artist = v.get("artist")
        if not artist:
            continue
        slug = extract_slug_from_url(v.get("url"))
        rec = out.setdefault(artist, {"shows_attended": 0, "known_slug": None})
        rec["shows_attended"] += 1
        if slug and not rec["known_slug"]:
            rec["known_slug"] = slug
    return out


def score_candidate(candidate, target_name, known_slug):
    """
    Score a /search/artists hit for how confident we are it's the right band.
    Higher score = better match. Returns (score, reason_str).
    """
    score = 0
    reasons = []
    cand_name = (candidate.get("name") or "").strip()
    cand_sort = (candidate.get("sortName") or "").strip()
    cand_url = candidate.get("url") or ""
    cand_slug = extract_slug_from_url(cand_url) or _slug_from_artist_url(cand_url)

    target_lower = target_name.lower()
    if cand_name.lower() == target_lower:
        score += 10
        reasons.append("exact name match")
    elif cand_name.lower().replace("the ", "") == target_lower.replace("the ", ""):
        score += 5
        reasons.append("name match (modulo 'The')")

    if cand_sort and cand_sort.lower() == target_lower:
        score += 2
        reasons.append("sortName match")

    # Strongest signal: the slug matches what we already have in our setlists cache
    if known_slug and cand_slug and cand_slug == known_slug:
        score += 20
        reasons.append(f"slug matches existing setlist URLs ({known_slug})")

    return score, ", ".join(reasons) if reasons else "no signals"


def _slug_from_artist_url(artist_url):
    """
    Setlist.fm artist URLs look like https://www.setlist.fm/setlists/the-mars-volta-bd6cffe.html
    Extract the slug part (everything before the trailing -<hex>.html).
    """
    if not artist_url:
        return None
    m = re.search(r"/setlists/(.+?)-[a-f0-9]{6,8}\.html", artist_url)
    return m.group(1) if m else None


def stats_id_from_artist_url(artist_url):
    """
    The setlist.fm /search/artists response gives us each artist's URL like
    https://www.setlist.fm/setlists/puscifer-3d6f5af.html — that trailing hex
    suffix IS the stats_id used in the stats page URL. Length varies (7-8 hex).

    This is *the* canonical way to get the stats_id. Earlier we tried deriving
    it from the MBID, but that's wrong: setlist.fm's internal artist ID is
    independent of the MusicBrainz MBID.
    """
    if not artist_url:
        return None
    m = re.search(r"/setlists/.+?-([a-f0-9]{6,8})\.html", artist_url)
    return m.group(1) if m else None


def main():
    parser = argparse.ArgumentParser(description="Resolve setlist.fm MBIDs for headliners.")
    parser.add_argument("--setlists", default="data/setlists.json",
                        help="Path to setlists.json (default: data/setlists.json)")
    parser.add_argument("--out", default="data/band_mbids.json",
                        help="Output cache path (default: data/band_mbids.json)")
    parser.add_argument("--overrides", default="data/band_mbids_overrides.json",
                        help="File for manual conflict resolution (default: data/band_mbids_overrides.json)")
    parser.add_argument("--refresh", action="store_true",
                        help="Re-resolve even if already cached")
    parser.add_argument("--limit", type=int, default=None,
                        help="Resolve only the first N artists (for testing)")
    parser.add_argument("--pause", type=float, default=1.0,
                        help="Seconds to wait between requests (default: 1.0)")
    args = parser.parse_args()

    api_key = load_api_key()
    if not api_key:
        print("Error: no setlist.fm API key found.", file=sys.stderr)
        print("See prefetch_setlists.py docstring for setup.", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.setlists):
        print(f"Error: {args.setlists} not found. Run prefetch_setlists.py first.", file=sys.stderr)
        sys.exit(1)

    with open(args.setlists) as f:
        setlists = json.load(f)

    headliners = collect_headliners(setlists)
    print(f"Unique headliners: {len(headliners)}")

    qualifying = sum(1 for r in headliners.values() if r["shows_attended"] >= BUCKET_LIST_THRESHOLD)
    print(f"  Qualifying for bucket list (≥{BUCKET_LIST_THRESHOLD} shows): {qualifying}")
    print()

    # Load existing cache
    cache = {}
    if os.path.exists(args.out):
        with open(args.out) as f:
            try:
                cache = json.load(f)
            except json.JSONDecodeError:
                print(f"Warning: {args.out} is malformed; starting fresh.")

    # Load any manual overrides — these win over auto-resolution
    overrides = {}
    if os.path.exists(args.overrides):
        with open(args.overrides) as f:
            try:
                ov = json.load(f)
                # Format: {"Artist Name": {"mbid": "...", "stats_id": "...", "slug": "..."}}
                # OR conflict markers we wrote (which we filter out — only resolved entries count)
                for name, entry in ov.items():
                    if isinstance(entry, dict) and entry.get("mbid"):
                        overrides[name] = entry
            except json.JSONDecodeError:
                print(f"Warning: {args.overrides} is malformed; ignoring.")

    if overrides:
        print(f"Applying {len(overrides)} manual overrides from {args.overrides}")

    work = []
    for name, rec in headliners.items():
        if name in overrides:
            entry = dict(overrides[name])
            entry["shows_attended"] = rec["shows_attended"]
            entry["qualifies_for_bucket_list"] = rec["shows_attended"] >= BUCKET_LIST_THRESHOLD
            cache[name] = entry
            continue
        if name in cache and not cache[name].get("_error") and not args.refresh:
            # Refresh the show count even if MBID is cached — the count may have changed
            cache[name]["shows_attended"] = rec["shows_attended"]
            cache[name]["qualifies_for_bucket_list"] = rec["shows_attended"] >= BUCKET_LIST_THRESHOLD
            continue
        work.append((name, rec))

    if args.limit:
        work = work[:args.limit]

    print(f"Already resolved: {sum(1 for n in cache if not cache[n].get('_error'))}")
    print(f"To resolve: {len(work)}")
    print()

    successes = 0
    conflicts = {}  # {artist_name: [candidate_summaries]}
    failures = []

    for i, (name, rec) in enumerate(work, 1):
        prefix = f"[{i:>3}/{len(work)}] {name[:40]}"
        result = search_artist(name, api_key)

        if result.get("_error"):
            print(f"{prefix} — FAILED ({result['_error']})")
            failures.append((name, result["_error"]))
            cache[name] = result
            time.sleep(args.pause)
            continue

        candidates = result.get("artist", []) or []
        if not candidates:
            print(f"{prefix} — no results")
            failures.append((name, "no results"))
            cache[name] = {"_error": "no results"}
            time.sleep(args.pause)
            continue

        # Score every candidate
        scored = []
        for c in candidates[:10]:  # don't bother past page 1 of relevance
            score, reason = score_candidate(c, name, rec["known_slug"])
            scored.append((score, c, reason))
        scored.sort(key=lambda x: -x[0])

        best_score, best, best_reason = scored[0]
        runner_up = scored[1] if len(scored) > 1 else None

        # Confidence check: if best score is decisively higher than the runner-up,
        # accept it. Otherwise flag as a conflict.
        is_confident = (
            best_score >= 10  # at least an exact name match
            and (runner_up is None or best_score - runner_up[0] >= 5)
        )

        if is_confident:
            mbid = best.get("mbid")
            artist_url = best.get("url")
            slug = extract_slug_from_url(artist_url) or _slug_from_artist_url(artist_url)
            stats_id = stats_id_from_artist_url(artist_url)
            entry = {
                "mbid": mbid,
                "stats_id": stats_id,
                "slug": slug,
                "artist_url": artist_url,
                "shows_attended": rec["shows_attended"],
                "qualifies_for_bucket_list": rec["shows_attended"] >= BUCKET_LIST_THRESHOLD,
                "resolution": best_reason,
            }
            cache[name] = entry
            successes += 1
            print(f"{prefix} — ok  → {slug}-{stats_id}  ({best_reason})")
        else:
            # Conflict — log candidates for manual override
            print(f"{prefix} — CONFLICT (top score={best_score})")
            conflict_summary = []
            for score, c, reason in scored[:5]:
                conflict_summary.append({
                    "score": score,
                    "name": c.get("name"),
                    "sortName": c.get("sortName"),
                    "disambiguation": c.get("disambiguation"),
                    "mbid": c.get("mbid"),
                    "url": c.get("url"),
                    "reason": reason,
                })
            conflicts[name] = conflict_summary
            cache[name] = {"_error": "conflict — see overrides file"}

        # Save incrementally every 10
        if i % 10 == 0 or i == len(work):
            with open(args.out, "w") as f:
                json.dump(cache, f, indent=2)
        time.sleep(args.pause)

    # Final save
    with open(args.out, "w") as f:
        json.dump(cache, f, indent=2)

    # Write conflicts file (or remove it if empty and exists)
    if conflicts:
        # Merge with any existing overrides — keep manual entries the user added,
        # add new conflicts as instructions for them to fill in.
        existing_overrides = {}
        if os.path.exists(args.overrides):
            with open(args.overrides) as f:
                try:
                    existing_overrides = json.load(f)
                except json.JSONDecodeError:
                    pass

        # Format: artist name → either a resolved override (mbid/stats_id/slug)
        # or a list of candidates (the user picks one and rewrites the entry)
        for name, candidates in conflicts.items():
            if name in existing_overrides and isinstance(existing_overrides[name], dict) and existing_overrides[name].get("mbid"):
                continue  # already resolved manually
            existing_overrides[name] = {
                "_NEEDS_RESOLUTION": True,
                "_instructions": (
                    f"Pick one candidate below and replace this entry with: "
                    f'{{"mbid": "<full mbid>", "stats_id": "<first 7 hex>", "slug": "<slug>"}}'
                ),
                "candidates": candidates,
            }

        with open(args.overrides, "w") as f:
            json.dump(existing_overrides, f, indent=2)

    # Summary
    print()
    print(f"Resolved: {successes}")
    print(f"Conflicts (need manual review): {len(conflicts)}")
    print(f"Failures: {len(failures)}")
    if conflicts:
        print()
        print(f"⚠️  {len(conflicts)} artists need manual disambiguation.")
        print(f"   Edit {args.overrides}, pick a candidate per conflict, then re-run.")
    if failures:
        print()
        print("Failures:")
        for name, err in failures[:10]:
            print(f"  {name}: {err}")


if __name__ == "__main__":
    main()
