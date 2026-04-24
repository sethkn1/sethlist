# Sethlist — Concert & Poster Journey

A self-contained web app for exploring a concert history and poster collection.

## Quick start

### Option A — Open it locally

Run a local web server from this folder:

```
python3 -m http.server 8000
```

Then visit <http://localhost:8000>.

(Just double-clicking `index.html` may not work — browsers block loading JSON from `file://` URLs. Use the command above.)

### Option B — Publish to GitHub Pages

1. Create a new GitHub repo (e.g. `sethlist`).
2. Upload the contents of this folder (or `git push`).
3. Repo → **Settings → Pages**, source: `main` branch, `/ (root)`.
4. Site goes live at `https://<your-github-username>.github.io/sethlist/`.

That's it. No build step. No server. Pure HTML/CSS/JS.

## The data pipeline

Your source of truth can be **either** Excel (`.xlsx`) **or** CSV — whichever is easier for you to edit.

```
python3 build_data.py <concerts-source> <posters-source>
```

Example:

```
# Start from your spreadsheets:
python3 build_data.py "Concert History.xlsx" "Poster Collection.xlsx"

# Or edit the CSVs directly:
python3 build_data.py data/concerts.csv data/posters.csv
```

Running `build_data.py` produces:

- `data/concerts.json` — consumed by the app
- `data/posters.json` — consumed by the app
- `data/concerts.csv` — editable mirror (add/edit/delete concerts here)
- `data/posters.csv` — editable mirror (add/edit/delete posters here)
- `data/poster_images.csv` — maps each poster to its image URLs (see below)

**Requires**: `pip install pandas openpyxl`

## Adding, editing, deleting shows

Two workflows depending on what you prefer:

### From Excel
1. Edit your `.xlsx` file.
2. Re-run `build_data.py` pointing at it.
3. Reload the app.

### From CSV
1. Open `data/concerts.csv` or `data/posters.csv` in any editor (VS Code, Numbers, Excel, Google Sheets, Notepad…).
2. Add a row, edit a row, or delete a row. Save.
3. Re-run `build_data.py data/concerts.csv data/posters.csv`.
4. Reload the app.

**ID column**: you can leave new rows' `id` blank — the build script will re-number them. But heads up: if you renumber, any image file names like `poster-7.jpg` may no longer map to the right poster. Image URLs via `poster_images.csv` use `poster_id` and get re-mapped by `date + artist`, which is more stable.

## Poster images

There are three ways to attach an image to a poster, and the app tries them in this order for each of the **Mine** and **Official** tabs:

1. **URL in `data/poster_images.csv`** (the normal path)
2. **Local file** at `images/personal/poster-<id>.jpg` or `images/official/poster-<id>.jpg`
3. **Paste-a-URL** button in the modal (stored in your browser's localStorage; device-specific)

### `poster_images.csv` format

```csv
poster_id,date,artist,personal_url,official_url
0,2010-07-05,Faith No More,https://drive.google.com/thumbnail?id=XXXXX&sz=w1000,
1,2012-07-01,Roger Waters,https://drive.google.com/thumbnail?id=YYYYY&sz=w1000,https://some-stock-image.jpg
...
```

- `personal_url` → your photo of the poster (shown in the **Mine** tab)
- `official_url` → a stock image of the poster (shown in the **Official** tab)

### Google Drive images

If your spreadsheet has a "Link to Photo" column with Google Drive view-URLs (like `https://drive.google.com/file/d/XXX/view?usp=drive_link`), `build_data.py` automatically:

1. Extracts the hyperlinks (even though the cell displays "Link to Photo")
2. Converts them to directly-embeddable thumbnail URLs (`https://drive.google.com/thumbnail?id=XXX&sz=w1000`)
3. Writes them into `poster_images.csv`

**For this to work, each file needs "Anyone with the link can view" sharing** in Drive. If a thumbnail doesn't load, open the source file in Drive, click Share, and set access to "Anyone with the link".

### Re-running the build script is safe

On re-runs, `poster_images.csv` is **preserved and merged** — your manually-added `official_url` values won't get overwritten, and new images discovered in the spreadsheet get added.

## File structure

```
sethlist/
├── index.html          ← the app
├── styles.css          ← visual design
├── app.js              ← logic (views, routing, modal)
├── cities.js           ← city coordinate lookup for the map
├── build_data.py       ← regenerate data/*.json and data/*.csv
├── data/
│   ├── concerts.json   ← consumed by the app
│   ├── posters.json    ← consumed by the app
│   ├── us-states.json  ← US map geometry
│   ├── concerts.csv    ← editable mirror
│   ├── posters.csv     ← editable mirror
│   └── poster_images.csv ← image URL mapping (editable)
├── vendor/
│   ├── d3.min.js       ← data viz / projection library
│   └── topojson-client.min.js
├── images/
│   ├── personal/       ← optional local fallback images
│   └── official/       ← optional local fallback images
└── README.md
```

## A few things that are intentional

- **Fully self-contained.** No CDN dependencies at runtime — d3, topojson-client, and the US map data are all in the `vendor/` and `data/` folders. Works offline. Works on GitHub Pages.
- **Expressobeans links** open in a new tab. I didn't scrape them because the site blocks automated access.
- **Variants are grouped automatically**. Same date + artist + location = same "show," and multiple posters roll up into one card with a variant count.
- **Fuzzy matching** between concerts and posters handles minor inconsistencies between your two spreadsheets (AVTT vs AVVT, NIN vs NIN & Soundgarden, a date off by 2 days, etc.) — your concerts still find their posters.
- **Two-way navigation**. Clicking a concert shows its posters; clicking a poster links back to the show.
- **Upcoming shows** appear dashed-bordered with a teal "UPCOMING" tag. Sortable, filterable, and hideable.
- **Mine-first, official-fallback** image priority. Thumbnail tiles use your personal photo if available, otherwise fall back to the official image, otherwise show a placeholder. Inside the modal, you can toggle between Mine and Official.
