"""
build_bucket_list.py — Aggregate per-band setlist.fm stats with the user's
attended-show data into a single data/bucket_list.json file consumed by
the app's Bucket List view (#/bucket-list) and the per-show modal coverage
section.

For every band that qualifies (see prefetch_band_mbids.py's
BUCKET_LIST_THRESHOLD — currently 1, meaning all headliners), this script:

  1. Reads the band's full live-song catalog from data/band_stats/<slug>.json
     (which prefetch_band_stats.py scrapes from setlist.fm's stats pages).

  2. Reads the user's actual heard songs from data/setlists.json — the
     cached setlist.fm API responses for every show the user attended.

  3. Computes per-band:
       - showsAttended  : how many qualifying shows the user has been to
       - totalLiveSongs : every unique song in the band's stats catalog
       - heardCount     : how many of those songs the user has heard live
       - coverage       : heardCount / totalLiveSongs (0..1)
       - unheard        : list of {name, count, songid} sorted by count desc

  4. Writes data/bucket_list.json with all bands plus a flatUnheard array
     across every band, sorted by play count descending — the canonical
     "what you're most likely to hear next time" master list.

This script has no network dependencies. It runs purely on the cached
data produced by prefetch_band_mbids.py and prefetch_band_stats.py, so
it's fast and idempotent.

Usage:
    python3 build_bucket_list.py
"""

import json
import datetime as dt
from pathlib import Path
from collections import defaultdict


def normalize_artist(name):
    """Match the JS normalizeArtistKey logic used in app.js so the keys we
    write here align with how the app looks them up. Lower-case, stripped,
    drop a leading "the "."""
    if not name:
        return ""
    s = name.strip().lower()
    if s.startswith("the "):
        s = s[4:]
    return s


def main():
    repo = Path(".")

    band_mbids_path = repo / "data" / "band_mbids.json"
    setlists_path   = repo / "data" / "setlists.json"
    band_stats_dir  = repo / "data" / "band_stats"
    out_path        = repo / "data" / "bucket_list.json"

    if not band_mbids_path.exists():
        raise SystemExit(f"Missing {band_mbids_path} — run prefetch_band_mbids.py first.")
    if not setlists_path.exists():
        raise SystemExit(f"Missing {setlists_path} — run prefetch_setlists.py first.")
    if not band_stats_dir.exists():
        raise SystemExit(f"Missing {band_stats_dir} — run prefetch_band_stats.py first.")

    band_mbids = json.loads(band_mbids_path.read_text())
    setlists   = json.loads(setlists_path.read_text())

    # Build a per-band set of heard song names, normalized lowercase for
    # matching across slight casing/spelling differences between setlist.fm's
    # event entries and its stats pages.
    heard_by_band = defaultdict(set)  # normalized_artist -> set of song titles (lowercase)
    for key, entry in setlists.items():
        if not entry or entry.get("_error"):
            continue
        # Use the role to count headliner shows only — bucket list is about
        # the headlining band's catalog. Opener data still informs us of
        # heard songs for that opener if they're a tracked headliner elsewhere.
        artist = entry.get("artist", "")
        norm = normalize_artist(artist)
        if not norm:
            continue
        for s in entry.get("sets", []):
            for song in s.get("songs", []):
                name = song.get("name")
                if not name:
                    continue
                if song.get("tape"):  # skip pre-show intro tapes
                    continue
                heard_by_band[norm].add(name.lower())

    bands_out = {}
    for artist, meta in band_mbids.items():
        if not meta.get("qualifies_for_bucket_list"):
            continue
        slug = meta.get("slug")
        if not slug:
            continue
        stats_path = band_stats_dir / f"{slug}.json"
        if not stats_path.exists():
            # No stats yet — typically because prefetch_band_stats.py hasn't
            # been run since this band became qualifying. Skip rather than
            # produce a half-baked entry; the user can re-run the prefetch
            # script to fill it in.
            continue
        try:
            stats = json.loads(stats_path.read_text())
        except json.JSONDecodeError as e:
            print(f"  ! Skipping {artist}: malformed {stats_path.name}: {e}")
            continue

        norm = normalize_artist(artist)
        heard = heard_by_band.get(norm, set())
        all_songs = stats.get("songs", []) or []

        # Partition the band's catalog into heard vs unheard. Match by
        # lowercase name; we don't have stable song-id matching across the
        # API and stats-page data sources.
        unheard = []
        heard_list = []
        for s in all_songs:
            name = s.get("name") or ""
            entry = {
                "name": name,
                "count": s.get("count", 0),
                "songid": s.get("songid"),
            }
            if name.lower() in heard:
                heard_list.append(entry)
            else:
                unheard.append(entry)

        # Sort both by setlist.fm play count desc — the "they play this most"
        # ordering. For unheard, this is the most-likely-to-hear-next list.
        # For heard, it's the canonical "this is what they play" reference.
        unheard.sort(key=lambda x: -x.get("count", 0))
        heard_list.sort(key=lambda x: -x.get("count", 0))

        total = len(all_songs)
        heard_count = len(heard_list)
        coverage = round(heard_count / total, 4) if total else 0.0

        bands_out[artist] = {
            "slug": slug,
            "stats_id": meta.get("stats_id"),
            "showsAttended": meta.get("shows_attended", 0),
            "totalLiveSongs": total,
            "heardCount": heard_count,
            "coverage": coverage,
            "unheard": unheard,
            "heard": heard_list,
        }

    # Cross-band flat list, sorted by play count desc.
    # Schema match: the bucket-list page's row renderer reads `song`, `band`,
    # `playCount`, `bandSlug`, `showsSeen`. Match those names exactly so the
    # page renders correctly. (The per-band `unheard` arrays use `name`/`count`
    # because that's what the modal-side renderers expect.)
    flat_unheard = []
    for artist, info in bands_out.items():
        for s in info["unheard"]:
            flat_unheard.append({
                "song": s["name"],
                "songid": s.get("songid"),
                "band": artist,
                "bandSlug": info["slug"],
                "playCount": s["count"],
                "showsSeen": info["showsAttended"],
            })
    flat_unheard.sort(key=lambda x: -x.get("playCount", 0))

    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "bands": bands_out,
        "flatUnheard": flat_unheard,
    }

    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))

    print(f"Wrote {out_path}")
    print(f"  Bands: {len(bands_out)}")
    print(f"  Total unheard songs (flat): {len(flat_unheard)}")
    if flat_unheard:
        top = flat_unheard[0]
        print(f"  Top of list: '{top['song']}' by {top['band']} (×{top['playCount']})")


if __name__ == "__main__":
    main()
