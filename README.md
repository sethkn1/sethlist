# Sethlist — A SethTime of live music

A self-contained web app for exploring a concert history and poster collection.

## How do I…?

Quick recipes for the most common updates. Each one assumes you've already done the [one-time setup](#typical-workflow-from-scratch).

### …add, edit, or remove a concert

1. Edit `Concert History.xlsx` directly (or `data/concerts.csv` if you prefer working in the CSV — both are valid sources for `build_data.py`).
2. Rebuild:
   ```
   python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx" --skip-wiki
   ```
   Use `--skip-wiki` if you didn't add any new artists. Skip the flag if you did — the script will look up Wikipedia images for the new ones.
3. If you added shows that have setlists on setlist.fm, fetch them:
   ```
   export SETLIST_FM_KEY=your-key
   python3 prefetch_setlists.py
   ```
   Already-cached setlists are skipped, so this is fast on re-runs.
4. Re-run `build_data.py` once more so the new setlist data gets folded into the per-band stats.

### …add, edit, or remove a poster (no images yet)

1. Edit `Poster Collection.xlsx`.
2. Rebuild:
   ```
   python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx" --skip-wiki
   ```
3. Open `data/poster_images.csv` — there's now a row for the new poster with empty `stock_url` and `personal_url`.

### …add an image to a poster

1. Get a sharable link to the image — typically a Google Drive file with **"Anyone with the link can view"** sharing turned on.
2. Open `data/poster_images.csv` and paste the URL into the right column for that poster:
   - `stock_url` — the official artwork (used for the gallery tile and most thumbnails)
   - `personal_url` — your own photo of the framed copy (used in the modal alongside the stock image)
3. Download the image locally so the live site doesn't depend on Drive:
   ```
   python3 download_drive_images.py
   ```
   Already-downloaded files are skipped. Use `--force` to re-download everything, or `--kind stock` / `--kind personal` to limit scope.
4. Commit `images/stock/` and `images/personal/` along with the updated CSV.

### …add a festival

A festival in your concerts spreadsheet is any row whose **Artist** name contains the word "Festival" (case-insensitive). All days sharing the same **Tour Name** are grouped into a single tile in the timeline.

1. Add the festival days to `Concert History.xlsx`. Each day is its own row. Set:
   - **Artist** = e.g. "Sonic Temple Festival - Day 1"
   - **Tour Name** = the same string for every day (e.g. "Sonic Temple 2024") — this is what groups them
2. Rebuild:
   ```
   python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx" --skip-wiki
   ```
3. The build script auto-seeds new rows in `data/festival_images.csv` for any new festival keys it discovers. Open the CSV and fill in for the new festival:
   - **`image_url`** — direct URL to the festival's logo or hero image (the build script downloads it locally to `images/festivals/<key>.<ext>`)
   - **`website_url`** — the festival's official site (renders as a "Festival site ↗" link in the modal)
   - **`wiki_url`** — Wikipedia article URL, if there is one (renders as a "Wikipedia ↗" link). Leave blank if none.
   - `wiki_extract` — auto-populated on the next build from the Wikipedia article's lead paragraph; you can edit or override
   - `local_image` — auto-populated; don't edit
4. Re-run the build to download the festival image:
   ```
   python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx" --skip-wiki
   ```
   Already-downloaded festival images are skipped. Use `--refresh-festival-images` to force re-download (e.g., if you replaced the URL with a better one).
5. Commit `images/festivals/` along with the updated CSV.

### …validate the concert and poster spreadsheets

Two scripts run internal-consistency checks (no API calls, fast):

```
python3 validate_concert_data.py "Concert History.xlsx"
python3 validate_poster_data.py "Poster Collection.xlsx" "Concert History.xlsx"
```

What they catch:

- **Spelling / inconsistencies**: "Distrubed" vs "Disturbed", curly vs straight apostrophes, case mismatches ("the Mars Volta" vs "The Mars Volta")
- **Cross-file mismatches**: a band spelled differently in posters than concerts (e.g., "NIN" in one and "Nine Inch Nails" in the other)
- **Orphan posters**: posters dated to shows that don't appear in the concerts spreadsheet
- **Attended-flag mismatches**: a poster marked "Attended: Yes" with no matching concert row
- **Structural issues**: missing required fields, malformed `Number` field (e.g., "47/" or "/50"), date issues

Each script writes a markdown report (`validation_report.md` / `poster_validation_report.md`) with a section per check. Spelling clusters show the most-frequent variant as the likely-canonical, with rarer variants flagged for your decision.

For a third validation pass that **uses setlist.fm** to cross-check your opening acts (does the API confirm the bands you say played?):

```
export SETLIST_FM_KEY=your-key
python3 validate_openers_api.py
```

This is slower (one API call per non-festival show) and the report is more advisory — bands missing from your sheet vs. setlist.fm aren't always errors (you may have skipped them deliberately).

### …refresh the bucket-list / song-stats data

The "bucket list" feature shows, per artist you've seen 2+ times, which songs from their discography you have heard live and which you haven't. It runs on cached setlist data and per-band stats scraped from setlist.fm.

To refresh after adding shows or after a setlist is added/edited on setlist.fm:

```
export SETLIST_FM_KEY=your-key
python3 prefetch_setlists.py             # pulls any new setlists
python3 prefetch_band_mbids.py           # resolves MusicBrainz IDs for new headliners
python3 prefetch_band_stats.py           # scrapes setlist.fm stats pages for play counts
python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx" --skip-wiki
```

`prefetch_band_mbids.py` and `prefetch_band_stats.py` only act on bands they don't already have data for, so re-runs are fast. The first time you run them is the slow run.

### …resize new About-page photos

```
./resize_about_photos.sh
```

Reads JPGs from `~/Downloads/aboutmepictures/`, resizes each to max 1600px on the longer edge, re-encodes at JPEG quality 82, and writes them to `images/about/`. macOS-only (uses the built-in `sips` tool — no Homebrew required).

---

## Typical workflow (from scratch)

One-time setup after you extract the zip:

```bash
# 1. Install Python deps
# (On macOS, use pip3 / python3 — Apple ships both python2 and python3.)
pip3 install pandas openpyxl

# 2. Build the data (Wikipedia lookup takes ~30-60 seconds)
python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx"

# 3. Download your Drive poster images locally
python3 download_drive_images.py

# 4. Fetch setlists from setlist.fm (requires free API key — see below)
export SETLIST_FM_KEY=your-key-here
python3 prefetch_setlists.py

# 5. Serve the app
python3 -m http.server 8000
# Visit http://localhost:8000
```

After that, whenever you update your spreadsheets:

```bash
python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx"
python3 download_drive_images.py      # skips files you've already downloaded
python3 prefetch_setlists.py           # skips setlists you've already fetched
```

## Quick start

### Run locally

```
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

### Publish to GitHub Pages

1. Create a public repo (e.g. `sethlist`)
2. Push the contents of this folder
3. Repo → **Settings → Pages** → Source: `main` branch, `/ (root)`
4. Live at `https://<your-github-username>.github.io/sethlist/`

## What's in this build

- **Backward-looking only**: the app shows shows you've already attended; future-dated rows in the data are quietly filtered out until their date passes
- **Festivals are grouped** into single tiles that expand to show each day attended. Detected automatically: any concert whose Artist name contains "Festival" gets grouped by Tour Name.
- **Festival lineup display**: festival days get a dedicated "FESTIVAL LINEUP" section with top 2 acts highlighted as Headliners, rest as Supporting Acts
- **Multi-poster shows** get a stacked thumbnail and "X posters" badge on the gallery card
- **Band images** via Wikipedia auto-lookup, CSV override for misses
- **Poster images** via a one-time Drive download script (avoids Google's 2024 hotlink restrictions)
- **Setlists inline**: each concert modal shows the actual song list (numbered, with encore labels) pulled from setlist.fm and cached at build time. Both headliners AND openers are fetched — for festivals, the top 5 acts per day.
- **Song-level stats**: Most-heard songs across all your shows, plus top song per artist, aggregated from every cached setlist
- **Scrolling poster marquee** at the top of the Posters view — pauses on hover, click a thumbnail to open the show modal, mirrors the current filter
- **Click any poster image** (in the show modal) to open it at full size as a lightbox — click backdrop, press Escape, or click × to dismiss
- **Not-attended posters** are desaturated with a "DIDN'T ATTEND" badge, and filterable via a chip
- **Setlist.fm links** on every concert card and in every concert modal
- **Expressobeans links** in every poster variant block
- **Show Notes** render as a callout in the concert modal and a preview on the card; **Poster Notes** render as italics in the variant block
- **Year/month jump rail** on both timeline and posters views with scroll-sync highlighting
- **Attended-with filter and stats**: filter shows by who you went with; see show-buddy rankings
- **Variant column** gets its own yellow-bordered badge separate from Type
- **Tagline** "A SethTime of live music" in the header and timeline view title

## Poster images (the reliable way)

Google Drive stopped reliably serving embedded `<img>` tags from other domains in 2024. The `drive.google.com/thumbnail` URLs still work if you open them in a browser tab, but they fail as embedded images on a hosted site.

The fix: **download your Drive images once, commit them to your repo, serve them from GitHub Pages.**

After running `build_data.py` (which populates `poster_images.csv` with Drive URLs):

```
python3 download_drive_images.py
```

This reads the Drive URLs from `data/poster_images.csv`, downloads each image, and saves them to `images/personal/poster-<id>.jpg`. Commit the `images/personal/` folder to your repo and you're done — the images will load reliably forever.

Re-runs skip files that already exist. Use `--force` to re-download everything.

**Requirement**: Each Drive file must be shared "Anyone with the link can view." If a file is restricted, the script logs it and skips to the next.

## Wikipedia band images

On first run, `build_data.py` (without `--skip-wiki`) looks up each unique artist on Wikipedia and saves the thumbnail URL to `data/band_images.csv`.

If results are disappointing:

```
python3 build_data.py concerts.xlsx posters.xlsx --verbose
```

This prints per-artist progress (which titles were tried, whether an article was found, whether it had an image). You can then manually edit `band_images.csv` to fix any misses — the CSV is preserved on future re-runs.

Common patterns that miss:
- Very short or unusual artist names (AVTT/PTTN, stage names without a Wikipedia page)
- Artists whose Wikipedia article has no image on it (rare, but happens)
- Ambiguous names where Wikipedia returns the "wrong" Tool

For any miss, paste a direct image URL into the `image_url` column and you're set.

## Setlist.fm integration

Each concert modal shows the actual setlist (song-by-song, numbered, with encores) pulled from setlist.fm. The data is pre-fetched at build time and cached locally — the live site makes zero API calls, so it works on GitHub Pages and stays fast.

**First-time setup:**

1. Register a free account at <https://www.setlist.fm/settings/api> and request an API key (it's instant)
2. Either export the key as an environment variable:
   ```
   export SETLIST_FM_KEY=your-key-here
   ```
   …or save it to a file named `.secrets` in the project root (single line, just the key)
3. Run the fetcher:
   ```
   python3 prefetch_setlists.py
   ```

The script will hit the API for:
- Every headliner setlist (via the setlist.fm URL in your spreadsheet)
- Every opening act setlist (via artist+date search on setlist.fm)
- For festival days, only the top 5 acts in the Opening Acts column (those you most likely saw)

First run typically takes around 5 minutes at the default 1-second pace — roughly 110 headliner + 200 opener requests. Cached to `data/setlists.json`. The script retries automatically on rate-limit or network timeouts, and saves progress every 10 requests, so interruptions are safe to resume. Opener searches that return no match are cached as errors so they're skipped on subsequent runs.

**Useful flags:**
- `--skip-openers` — only fetch headliners (faster, if you just added new shows)
- `--refresh` — re-fetch everything, including previously-cached errors
- `--limit 5` — only the first 5 headliners (smoke test)
- `--festival-top-n 10` — pull more acts per festival day (default 5)

**Re-running:**

- By default, already-cached setlists are skipped (fast — only fetches new shows)
- `--refresh` re-fetches everything (use after someone on setlist.fm updates a setlist)
- `--limit 5` fetches only the first 5 (smoke test)

**If a setlist doesn't appear in the app:**

- The setlist.fm URL might be mismatched (you can verify by clicking "Setlist.fm ↗" in the modal)
- The API might have returned a 404 — check `data/setlists.json` for the error entry
- Newer shows may not have setlists yet on setlist.fm

## Rebuilding the data

```
python3 build_data.py <concerts_source> <posters_source>
```

Sources can be `.xlsx` or `.csv`:

```
# From spreadsheets:
python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx"

# From CSVs (after you've edited them):
python3 build_data.py data/concerts.csv data/posters.csv

# Skip Wikipedia enrichment (faster, no internet needed):
python3 build_data.py concerts.xlsx posters.xlsx --skip-wiki
```

Running generates:

- `data/concerts.json` — consumed by the app
- `data/posters.json` — consumed by the app
- `data/concerts.csv` — editable mirror (add/edit/delete concerts here)
- `data/posters.csv` — editable mirror (add/edit/delete posters here)
- `data/poster_images.csv` — maps each poster to its image URLs (editable)
- `data/band_images.csv` — Wikipedia-fetched band thumbnails (editable to override)

**Requires**: `pip3 install pandas openpyxl` on macOS, `pip install` on other systems (uses stdlib urllib for Wikipedia — no `requests` needed)

## Band images via Wikipedia

On first run, `build_data.py` looks up each unique artist on Wikipedia and saves the thumbnail URL + website link to `data/band_images.csv`. You can:

- **Override a bad Wikipedia result** by editing the `image_url` column
- **Add a band website** by filling in the `website_url` column (the app shows it as "Official site ↗" in the concert modal)
- **Skip Wikipedia entirely** with `--skip-wiki` — all bands show as placeholder badges with initials

When a Wikipedia hit isn't found, the band shows as a colored placeholder with their initials (e.g. "NIN", "PU", "QOTSA"). Intentional, not a bug.

## Festival detection

A concert is treated as a festival day if its **Artist name contains "Festival"** (case-insensitive). All festival days sharing the same **Tour Name** are grouped into one tile.

Your data currently has 5 festivals: Rock on the Range 2018 (3 days), Welcome to Rockville 2021 (4 days), Welcome to Rockville 2023 (1 day), Blue Ridge Rock Fest 2023 (1 day), Sonic Temple 2024 (4 days).

In stats, festival days count individually in "Shows attended" AND get a separate "Festivals" counter for multi-day events.

## Poster images

The app tries these sources in order:

1. **URL in `data/poster_images.csv`** (`personal_url` for Mine tab, `official_url` for Official tab)
2. **Local file** at `images/personal/poster-<id>.jpg` or `images/official/poster-<id>.jpg`
3. **Placeholder** with "Paste URL" button (stored in browser localStorage)

Google Drive URLs (from the spreadsheet's "Link to Personal Photo" hyperlinks) are auto-converted to `drive.google.com/thumbnail?id=XXX&sz=w1000` format that embeds directly in `<img>` tags. **For this to work, each Drive file needs "Anyone with the link can view" sharing.**

On re-runs, `poster_images.csv` is **preserved and merged** — manually-added URLs survive future builds.

## File structure

```
sethlist/
├── index.html                  the app
├── styles.css                  visual design
├── app.js                      logic (views, routing, modal)
├── cities.js                   city coordinate lookup
├── build_data.py               data pipeline
├── download_drive_images.py    one-time Drive → local image downloader
├── prefetch_setlists.py        setlist.fm API fetcher
├── prefetch_band_mbids.py      resolves MusicBrainz IDs for headliners
├── prefetch_band_stats.py      scrapes per-band play-count stats
├── validate_concert_data.py    internal-consistency check on concerts xlsx
├── validate_poster_data.py     internal-consistency check on posters xlsx
├── validate_openers_api.py     cross-checks openers against setlist.fm
├── resize_about_photos.sh      macOS-only image resizer for About page
├── data/
│   ├── concerts.json           consumed by the app
│   ├── posters.json            consumed by the app
│   ├── setlists.json           consumed by the app (setlist.fm cache)
│   ├── us-states.json          US map geometry
│   ├── concerts.csv            editable mirror
│   ├── posters.csv             editable mirror
│   ├── poster_images.csv       image URLs (editable)
│   ├── band_images.csv         band images + websites (editable)
│   ├── festival_images.csv     festival logos, websites, wiki links (editable)
│   ├── band_mbids.json         MusicBrainz IDs per headliner
│   ├── band_stats/             per-band setlist.fm play-count data
│   └── bucket_list.json        derived: which songs you've heard live per band
├── vendor/
│   ├── d3.min.js
│   └── topojson-client.min.js
├── images/
│   ├── about/                  resized photos for the About page
│   ├── stock/                  poster stock images (downloaded by script)
│   ├── personal/               your own photos of framed posters
│   └── festivals/              festival logos (downloaded by script)
└── README.md
```

## Design notes

- **Fully self-contained** at runtime. No CDN calls, no APIs hit from the live site. Wikipedia is only touched when you run `build_data.py`.
- **Fuzzy matching** between concerts and posters handles data inconsistencies (typos, date mismatches, "Guns N' Roses" vs "Guns N Roses"). Your concerts still find their posters even if spreadsheets disagree.
- **Upcoming shows** get dashed borders and a teal "UPCOMING" tag. Filterable and hideable.
- **Expressobeans** links are passthrough; no scraping attempted.
