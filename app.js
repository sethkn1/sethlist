/* ============================================================
   Sethlist — app logic
   Vanilla JS, hash-based router, loads JSON/CSV data locally.
   ============================================================ */

const STATE = {
  concerts: [],
  posters: [],
  // poster_id -> { personal_url, official_url }
  posterImages: {},
  // artist name (case-normalized) -> { image_url, website_url, wiki_url, wiki_extract }
  bandImages: {},
  // setlist_id -> { artist, tour, sets: [{name, encore, songs: [{name, cover, tape, info}]}] }
  setlists: {},
  // state code -> full name
  stateNames: {
    AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
    CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",
    IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",
    ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",
    MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
    NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
    OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
    SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",
    WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"District of Columbia"
  },
  stateCodes: {},
  posterOverrides: loadOverrides(),
  // Which festival groups are currently expanded in the timeline
  expandedFestivals: new Set(),
};

function loadOverrides() {
  try {
    const raw = localStorage.getItem("sethlist.posterOverrides");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveOverrides() {
  try { localStorage.setItem("sethlist.posterOverrides", JSON.stringify(STATE.posterOverrides)); } catch {}
}

/* ============================================================
   DATA LOADING
   ============================================================ */
async function loadData() {
  const [c, p, imagesCsv, bandsCsv, setlists] = await Promise.all([
    fetch("data/concerts.json").then(r => r.json()),
    fetch("data/posters.json").then(r => r.json()),
    fetch("data/poster_images.csv").then(r => r.ok ? r.text() : "").catch(() => ""),
    fetch("data/band_images.csv").then(r => r.ok ? r.text() : "").catch(() => ""),
    fetch("data/setlists.json").then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);
  // This app is backward-looking only — filter out any future-dated shows
  const today = new Date();
  STATE.concerts = c.filter(x => new Date(x.date) <= today);
  STATE.posters = p;
  STATE.posterImages = parsePosterImagesCSV(imagesCsv);
  STATE.bandImages = parseBandImagesCSV(bandsCsv);
  STATE.setlists = setlists || {};

  Object.entries(STATE.stateNames).forEach(([code, name]) => {
    STATE.stateCodes[name.toLowerCase()] = code;
  });

  document.getElementById("brand-sub").textContent =
    `${STATE.concerts.length} shows · ${p.length} posters`;
}

/* ============================================================
   CSV PARSING
   ============================================================ */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ""; }
      else if (ch === '"') inQ = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parsePosterImagesCSV(text) {
  const out = {};
  if (!text) return out;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return out;
  const h = splitCsvLine(lines[0]);
  const idx = {
    id: h.indexOf("poster_id"),
    personal: h.indexOf("personal_url"),
    official: h.indexOf("official_url"),
  };
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const pid = parseInt(cols[idx.id], 10);
    if (Number.isNaN(pid)) continue;
    out[pid] = {
      personal_url: (cols[idx.personal] || "").trim() || null,
      official_url: (cols[idx.official] || "").trim() || null,
    };
  }
  return out;
}

function parseBandImagesCSV(text) {
  const out = {};
  if (!text) return out;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return out;
  const h = splitCsvLine(lines[0]);
  const idx = {
    artist: h.indexOf("artist"),
    image: h.indexOf("image_url"),
    website: h.indexOf("website_url"),
    wiki: h.indexOf("wiki_url"),
    extract: h.indexOf("wiki_extract"),
  };
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const name = (cols[idx.artist] || "").trim();
    if (!name) continue;
    out[name.toLowerCase()] = {
      artist: name,
      image_url: (cols[idx.image] || "").trim() || null,
      website_url: (cols[idx.website] || "").trim() || null,
      wiki_url: (cols[idx.wiki] || "").trim() || null,
      wiki_extract: (cols[idx.extract] || "").trim() || null,
    };
  }
  return out;
}

/* ============================================================
   ROUTER
   ============================================================ */
const ROUTES = {
  "#/timeline": renderTimeline,
  "#/map": renderMap,
  "#/posters": renderPosters,
  "#/stats": renderStats,
};

function router() {
  let hash = window.location.hash || "#/timeline";
  const [path] = hash.split("?");
  const fn = ROUTES[path] || renderTimeline;
  document.querySelectorAll(".main-nav a").forEach(a => {
    a.classList.toggle("active", a.getAttribute("href") === path);
  });
  // Don't scroll to top if the user is actively typing in a search box —
  // that would be jarring and would also feel like the page is being reset.
  const isTyping = document.activeElement &&
    (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA");
  if (!isTyping) {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  withPreservedFocus(fn);
}

/* ============================================================
   HELPERS
   ============================================================ */
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function isFuture(iso) {
  return new Date(iso) > new Date();
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "on" && typeof v === "object") {
      for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
    } else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}
function classifyType(t) {
  if (!t) return "";
  const s = t.toLowerCase();
  if (s.includes("foil")) return "Foil";
  if (s.includes("vip")) return "VIP";
  if (s.includes("ap")) return "AP";
  return "SE";
}
function bandLookup(artist) {
  if (!artist) return null;
  return STATE.bandImages[artist.toLowerCase()] || null;
}

/**
 * Extract the 8-char setlist.fm ID from a setlist URL.
 * Used to look up the cached setlist data in STATE.setlists.
 */
function extractSetlistId(url) {
  if (!url) return null;
  const m = url.match(/-([a-f0-9]{7,8})\.html/);
  return m ? m[1] : null;
}

function setlistForConcert(c) {
  const sid = extractSetlistId(c.setlistLink);
  if (!sid) return null;
  const sl = STATE.setlists[sid];
  if (!sl || sl._error) return null;
  return sl;
}

/**
 * Render a setlist block from the pre-fetched cache.
 * Shows each set in order; encores get "Encore" label. Songs are numbered
 * continuously. Covers and tape intros get small annotations inline.
 */
function renderSetlistBlock(setlist) {
  const block = el("div", { class: "setlist-block" });
  block.appendChild(el("h4", { class: "setlist-title" }, "Setlist"));
  if (setlist.tour && !setlist.tour.match(/^[\s\-—]*$/)) {
    block.appendChild(el("div", { class: "setlist-tour" }, setlist.tour));
  }

  let songNumber = 0;
  setlist.sets.forEach((s, setIdx) => {
    // Label the set header if it has one, or "Encore"
    let setLabel = null;
    if (s.encore) {
      setLabel = s.encore === 1 ? "Encore" : `Encore ${s.encore}`;
    } else if (s.name) {
      setLabel = s.name;
    } else if (setIdx > 0) {
      // Multi-set shows with no explicit name — just indicate a break
      setLabel = `Set ${setIdx + 1}`;
    }
    if (setLabel) {
      block.appendChild(el("div", { class: "setlist-set-label" }, setLabel));
    }

    const ol = el("ol", { class: "setlist-songs", start: songNumber + 1 });
    s.songs.forEach(song => {
      songNumber++;
      const li = el("li", { class: "setlist-song" });
      if (song.tape) {
        li.classList.add("tape");
      }
      li.appendChild(el("span", { class: "song-name" }, song.name || "(unknown)"));
      const notes = [];
      if (song.tape) notes.push("tape");
      if (song.cover) notes.push(`cover of ${song.cover}`);
      if (song.with) notes.push(`with ${song.with}`);
      if (song.info) notes.push(song.info);
      if (notes.length) {
        li.appendChild(el("span", { class: "song-note" }, ` · ${notes.join(" · ")}`));
      }
      ol.appendChild(li);
    });
    block.appendChild(ol);
  });

  // Attribution
  if (setlist.url) {
    block.appendChild(el("div", { class: "setlist-attrib" },
      "From ",
      el("a", {
        href: setlist.url, target: "_blank", rel: "noopener",
        class: "setlist-attrib-link"
      }, "setlist.fm ↗")
    ));
  }

  return block;
}

function artistInitials(artist) {
  if (!artist) return "?";
  // For festivals, use the first two letters
  // Otherwise, initials of words, up to 3
  const words = artist.replace(/[^\w\s'&/-]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join("").toUpperCase();
}

/* ============================================================
   ATTENDED-WITH helpers
   ============================================================ */
// Manually curated nickname → canonical mapping. Add entries here as you
// discover variations in your data.
const NAME_ALIASES = {
  "jason carpentier": "Jay Carpentier",
};

function canonicalName(n) {
  if (!n) return null;
  const trimmed = n.trim();
  if (!trimmed) return null;
  const alias = NAME_ALIASES[trimmed.toLowerCase()];
  return alias || trimmed;
}

function splitAttendedWith(s) {
  if (!s) return [];
  // Split on comma, semicolon, ampersand, " and "
  const parts = s.split(/[,;&]|\sand\s/i);
  return parts.map(p => canonicalName(p)).filter(Boolean);
}

/**
 * Split an "Opening Acts" / festival lineup string into individual band names.
 * The spreadsheet format is simple comma-separated, but we defensively also
 * split on semicolons and strip common narrative prefixes/suffixes.
 */
function splitActs(s) {
  if (!s) return [];
  const parts = String(s).split(/[,;]/);
  const out = [];
  for (let p of parts) {
    p = p.trim();
    if (!p) continue;
    // Drop parenthetical notes like "(co-headline)", "(dropped)"
    p = p.replace(/\s*\([^)]*\)\s*/g, "").trim();
    if (!p) continue;
    out.push(p);
  }
  return out;
}

/**
 * Return all artists the user saw at a given concert: the headliner plus
 * every band in `openingActs` (which for festival rows contains the full day lineup).
 * For festival rows we skip the synthetic "Festival" headliner name since
 * that's not a band. Results are not deduplicated within a single concert.
 */
function allArtistsAtConcert(c) {
  const out = [];
  // Festival "artist" is the festival name (e.g. "Welcome To Rockville Festival"),
  // not a band — skip.
  if (c.artist && !c.festivalKey) out.push(c.artist);
  splitActs(c.openingActs).forEach(a => out.push(a));
  return out;
}

/**
 * Lower-case, strip punctuation, drop leading "The " — used to determine
 * whether two artist strings refer to the same band. "Mars Volta" should
 * match "The Mars Volta", and case/punctuation differences are ignored.
 */
function normalizeArtistKey(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Multi-select popover widget for filtering by "Attended With" names.
 * Shows as a chip-style button in the filter bar; click to expand a panel
 * with checkboxes. Selected names go into URL param `withPerson` as a
 * comma-separated list.
 */
function attendedWithPopover(allNames, counts, selected) {
  const wrap = el("div", { class: "filter-popover-wrap" });
  const selectedSet = new Set(selected);
  const label = selected.length === 0
    ? "Anyone"
    : (selected.length === 1 ? selected[0] : `${selected.length} people`);

  const btn = el("button", {
    class: "chip filter-popover-btn" + (selected.length > 0 ? " active" : ""),
    "aria-expanded": "false",
    on: {
      click: e => {
        e.stopPropagation();
        const panel = wrap.querySelector(".filter-popover-panel");
        const isOpen = !panel.hidden;
        document.querySelectorAll(".filter-popover-panel").forEach(p => p.hidden = true);
        panel.hidden = isOpen;
        btn.setAttribute("aria-expanded", (!isOpen).toString());
      }
    }
  }, "With: " + label);
  wrap.appendChild(btn);

  const panel = el("div", { class: "filter-popover-panel", hidden: true });
  panel.addEventListener("click", e => e.stopPropagation());

  // Search/filter the name list
  const search = el("input", {
    type: "text",
    class: "popover-search",
    placeholder: "Filter names…",
    on: {
      input: e => {
        const q = e.target.value.toLowerCase();
        panel.querySelectorAll(".popover-option").forEach(opt => {
          const name = opt.dataset.name.toLowerCase();
          opt.style.display = name.includes(q) ? "" : "none";
        });
      }
    }
  });
  panel.appendChild(search);

  // Clear button
  if (selected.length > 0) {
    panel.appendChild(el("button", {
      class: "popover-clear",
      on: { click: () => updateParam("withPerson", "") }
    }, "Clear all"));
  }

  const list = el("div", { class: "popover-list" });
  allNames.forEach(name => {
    const opt = el("label", { class: "popover-option", "data-name": name });
    const cb = el("input", {
      type: "checkbox",
      checked: selectedSet.has(name),
      on: {
        change: e => {
          if (e.target.checked) selectedSet.add(name);
          else selectedSet.delete(name);
          const str = [...selectedSet].join(",");
          updateParam("withPerson", str);
        }
      }
    });
    opt.appendChild(cb);
    opt.appendChild(el("span", { class: "popover-name" }, name));
    opt.appendChild(el("span", { class: "popover-count" }, String(counts[name] || 0)));
    list.appendChild(opt);
  });
  panel.appendChild(list);

  wrap.appendChild(panel);

  // Close on outside click (bound once per render)
  if (!document.body.dataset.popoverCloser) {
    document.body.dataset.popoverCloser = "1";
    document.addEventListener("click", () => {
      document.querySelectorAll(".filter-popover-panel").forEach(p => p.hidden = true);
      document.querySelectorAll(".filter-popover-btn").forEach(b =>
        b.setAttribute("aria-expanded", "false"));
    });
  }

  return wrap;
}

/* ============================================================
   BAND IMAGE RENDERING
   ============================================================ */
function bandThumb(artist, size = 64) {
  const info = bandLookup(artist);
  const wrap = el("div", { class: "band-thumb", style: `--thumb-size: ${size}px;` });
  if (info && info.image_url) {
    const img = el("img", {
      src: info.image_url,
      alt: artist,
      loading: "lazy",
      on: {
        error: function() {
          this.remove();
          wrap.classList.add("band-thumb-placeholder");
          wrap.textContent = artistInitials(artist);
        }
      }
    });
    wrap.appendChild(img);
  } else {
    wrap.classList.add("band-thumb-placeholder");
    wrap.textContent = artistInitials(artist);
  }
  return wrap;
}

function bandBanner(artist) {
  const info = bandLookup(artist);
  const wrap = el("div", { class: "band-banner" });
  if (info && info.image_url) {
    const img = el("img", {
      src: info.image_url,
      alt: artist,
      loading: "lazy",
      on: {
        error: function() {
          this.remove();
          wrap.classList.add("band-banner-placeholder");
          wrap.textContent = artistInitials(artist);
        }
      }
    });
    wrap.appendChild(img);
  } else {
    wrap.classList.add("band-banner-placeholder");
    wrap.textContent = artistInitials(artist);
  }
  return wrap;
}

/* ============================================================
   TIMELINE VIEW
   ============================================================ */
function renderTimeline() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const params = new URLSearchParams((location.hash.split("?")[1] || ""));
  const q = params.get("q") || "";
  const state = params.get("state") || "";
  const artist = params.get("artist") || "";
  const posterOnly = params.get("posterOnly") === "1";
  const festival = params.get("festival") || ""; // festivalKey to focus on
  // Attended-with filter: comma-separated list of canonical names
  const attendedWithFilter = (params.get("withPerson") || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  app.appendChild(el("div", { class: "view-header" },
    el("h2", { class: "view-title" },
      "A ",
      el("span", { class: "accent" }, "SethTime"),
      " of live music"
    ),
    el("p", { class: "view-sub" }, "Chronological. Newest on top.")
  ));

  // Build filters
  const allStates = [...new Set(STATE.concerts.map(c => c.state).filter(Boolean))].sort();
  const allArtists = [...new Set(STATE.concerts.map(c => c.artist).filter(Boolean))].sort();
  // All unique attended-with names with counts (sorted by frequency)
  const nameCounts = {};
  STATE.concerts.forEach(c => {
    splitAttendedWith(c.attendedWith).forEach(n => {
      nameCounts[n] = (nameCounts[n] || 0) + 1;
    });
  });
  const allNames = Object.keys(nameCounts).sort((a, b) =>
    (nameCounts[b] - nameCounts[a]) || a.localeCompare(b));

  const filterBar = el("div", { class: "filter-bar" });

  filterBar.appendChild(el("input", {
    type: "text", placeholder: "Search artist, venue, city, tour…", value: q,
    on: { input: e => updateParamDebounced("q", e.target.value) }
  }));

  const stateSelect = el("select", {
    on: { change: e => updateParam("state", e.target.value) }
  });
  stateSelect.appendChild(el("option", { value: "" }, "All states"));
  allStates.forEach(s => {
    const opt = el("option", { value: s }, STATE.stateNames[s] || s);
    if (s === state) opt.selected = true;
    stateSelect.appendChild(opt);
  });
  filterBar.appendChild(stateSelect);

  const artistSelect = el("select", {
    on: { change: e => updateParam("artist", e.target.value) }
  });
  artistSelect.appendChild(el("option", { value: "" }, "All artists"));
  allArtists.forEach(a => {
    const opt = el("option", { value: a }, a);
    if (a === artist) opt.selected = true;
    artistSelect.appendChild(opt);
  });
  filterBar.appendChild(artistSelect);

  // Attended With multi-select popover
  filterBar.appendChild(attendedWithPopover(allNames, nameCounts, attendedWithFilter));

  filterBar.appendChild(el("button", {
    class: "chip" + (posterOnly ? " active" : ""),
    on: { click: () => updateParam("posterOnly", posterOnly ? "0" : "1") }
  }, "With poster"));

  const countEl = el("div", { class: "filter-count" });
  filterBar.appendChild(countEl);
  app.appendChild(filterBar);

  // Filter
  const qLower = q.toLowerCase();
  let filtered = STATE.concerts.filter(c => {
    if (state && c.state !== state) return false;
    if (artist && c.artist !== artist) return false;
    if (posterOnly && !c.hasPoster) return false;
    if (attendedWithFilter.length > 0) {
      const attendees = splitAttendedWith(c.attendedWith);
      // ANY match — show the show if ANY selected person attended
      const hit = attendedWithFilter.some(selected =>
        attendees.some(a => a === selected));
      if (!hit) return false;
    }
    if (qLower) {
      const hay = [
        c.artist, c.venue, c.city, c.tourName, c.openingActs, c.notes,
        c.attendedWith, c.festivalName
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => b.date.localeCompare(a.date));

  // Group festivals, but ONLY if not already filtering by a specific artist or festival
  const shouldGroupFestivals = !artist && !festival;

  const groupedItems = [];
  if (shouldGroupFestivals) {
    const seenFestivals = new Set();
    for (const c of filtered) {
      if (c.festivalKey) {
        if (seenFestivals.has(c.festivalKey)) continue;
        seenFestivals.add(c.festivalKey);
        // Collect ALL days of this festival that also match the filter
        const days = filtered.filter(x => x.festivalKey === c.festivalKey);
        groupedItems.push({ type: "festival", key: c.festivalKey, days });
      } else {
        groupedItems.push({ type: "concert", concert: c });
      }
    }
  } else {
    filtered.forEach(c => groupedItems.push({ type: "concert", concert: c }));
  }

  // Count for display: count each concert (days in a festival count individually)
  countEl.textContent = `${filtered.length} show${filtered.length === 1 ? "" : "s"}`;

  if (groupedItems.length === 0) {
    app.appendChild(el("div", { class: "loading" }, "No shows match these filters."));
    return;
  }

  // Group by year
  const byYear = {};
  groupedItems.forEach(item => {
    const y = item.type === "festival"
      ? (new Date(item.days[0].date + "T00:00:00")).getFullYear()
      : item.concert.year;
    (byYear[y] = byYear[y] || []).push(item);
  });
  const years = Object.keys(byYear).sort((a, b) => b - a);

  const timeline = el("div", { class: "timeline" });
  // Track months per year for the jump menu
  const yearMonthsMap = {};
  years.forEach(year => {
    const block = el("div", { class: "year-block", id: `year-${year}` });
    const items = byYear[year];
    const showCount = items.reduce((s, it) => s + (it.type === "festival" ? it.days.length : 1), 0);

    block.appendChild(el("div", { class: "year-label" }, year));
    block.appendChild(el("div", { class: "year-meta" },
      `${showCount} show${showCount === 1 ? "" : "s"}`));

    // Group items within the year by month
    const byMonth = {};
    items.forEach(it => {
      const d = it.type === "festival" ? it.days[0].date : it.concert.date;
      const month = d ? (new Date(d + "T00:00:00")).getMonth() : 0;
      (byMonth[month] = byMonth[month] || []).push(it);
    });
    const months = Object.keys(byMonth).sort((a, b) => b - a);  // Dec first
    yearMonthsMap[year] = months.map(Number);

    const MONTH_NAMES = ["January","February","March","April","May","June",
                         "July","August","September","October","November","December"];

    months.forEach(m => {
      // Anchor for this year+month
      const anchor = el("div", {
        id: `year-${year}-month-${m}`,
        class: "month-anchor"
      });
      block.appendChild(anchor);

      // Light month header (only if multiple months this year)
      if (months.length > 1) {
        block.appendChild(el("div", { class: "month-sub" }, MONTH_NAMES[m]));
      }

      const grid = el("div", { class: "concert-grid" });
      byMonth[m].forEach(it => {
        if (it.type === "festival") {
          grid.appendChild(festivalTile(it.key, it.days));
        } else {
          grid.appendChild(concertCard(it.concert));
        }
      });
      block.appendChild(grid);
    });
    timeline.appendChild(block);
  });
  app.appendChild(timeline);

  // Floating jump-to-year menu
  app.appendChild(buildYearJumpMenu(years, yearMonthsMap));
}

// Track the currently-active scroll observer so we can disconnect it when
// a new view is rendered (otherwise multiple observers pile up).
let currentScrollObserver = null;

function buildYearJumpMenu(years, yearMonthsMap) {
  const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun",
                       "Jul","Aug","Sep","Oct","Nov","Dec"];
  const nav = el("nav", {
    class: "year-jump",
    "aria-label": "Jump to year",
    tabindex: "0"
  });
  nav.appendChild(el("div", { class: "year-jump-handle" }, "Jump to"));

  const list = el("div", { class: "year-jump-list" });
  years.forEach(y => {
    list.appendChild(el("a", {
      class: "year-jump-year",
      href: `#year-${y}`,
      "data-year": String(y),
      on: {
        click: e => {
          e.preventDefault();
          const target = document.getElementById(`year-${y}`);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }, y));
    (yearMonthsMap[y] || []).forEach(m => {
      list.appendChild(el("a", {
        class: "year-jump-month",
        href: `#year-${y}-month-${m}`,
        "data-year": String(y),
        "data-month": String(m),
        on: {
          click: e => {
            e.preventDefault();
            const target = document.getElementById(`year-${y}-month-${m}`);
            if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }, MONTH_SHORT[m]));
    });
  });
  nav.appendChild(list);

  // Schedule scroll sync after this nav (and the content it points to) is in the DOM
  setTimeout(() => setupScrollSync(nav, years, yearMonthsMap), 0);

  return nav;
}

/**
 * Keep the jump menu in sync with scroll position.
 * - Always highlights the year the user is currently viewing.
 * - If that year has multiple months, also highlights the month.
 * Uses IntersectionObserver to detect which anchors are in view.
 */
function setupScrollSync(nav, years, yearMonthsMap) {
  if (currentScrollObserver) {
    currentScrollObserver.disconnect();
    currentScrollObserver = null;
  }

  // Track visibility of each year-block and month-anchor
  const yearVisible = new Map();   // year (string) -> intersecting ratio
  const monthVisible = new Map();  // "year-month" -> intersecting ratio

  const update = () => {
    // Pick active year = year with the most visible area
    let activeYear = null;
    let bestYearRatio = 0;
    yearVisible.forEach((ratio, year) => {
      if (ratio > bestYearRatio) {
        bestYearRatio = ratio;
        activeYear = year;
      }
    });

    // Pick active month within active year (if that year has multi-months)
    let activeMonth = null;
    if (activeYear && (yearMonthsMap[activeYear] || []).length > 1) {
      let bestMonthRatio = 0;
      monthVisible.forEach((ratio, key) => {
        const [y, m] = key.split("-");
        if (y !== activeYear) return;
        if (ratio > bestMonthRatio) {
          bestMonthRatio = ratio;
          activeMonth = m;
        }
      });
    }

    // Apply .active class
    let newActiveEl = null;
    nav.querySelectorAll(".year-jump-year, .year-jump-month").forEach(a => {
      const y = a.dataset.year;
      const m = a.dataset.month;
      const isYear = !m;
      let matches;
      if (isYear) {
        matches = y === activeYear;
      } else {
        matches = y === activeYear && m === activeMonth;
      }
      a.classList.toggle("active", matches);
      // Track the year link (not the month) as the scroll anchor to keep
      // the menu roughly oriented on the current year.
      if (matches && isYear) newActiveEl = a;
    });

    // Keep the active year visible inside the scrollable jump list.
    // Only scroll within the jump menu container — not the page itself.
    if (newActiveEl) {
      const list = nav.querySelector(".year-jump-list");
      if (list) {
        const listRect = list.getBoundingClientRect();
        const itemRect = newActiveEl.getBoundingClientRect();
        const outOfView =
          itemRect.top < listRect.top + 20 ||
          itemRect.bottom > listRect.bottom - 20;
        if (outOfView) {
          // Center-ish the active item within the visible list
          const offset = newActiveEl.offsetTop - (list.clientHeight / 2 - newActiveEl.clientHeight / 2);
          list.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
        }
      }
    }
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const el = entry.target;
      if (el.classList.contains("year-block")) {
        const year = el.id.replace("year-", "");
        if (entry.isIntersecting) {
          yearVisible.set(year, entry.intersectionRatio || 0.01);
        } else {
          yearVisible.delete(year);
        }
      } else if (el.classList.contains("month-anchor")) {
        // id: year-<y>-month-<m>
        const match = el.id.match(/^year-(\d+)-month-(\d+)$/);
        if (match) {
          const key = `${match[1]}-${match[2]}`;
          if (entry.isIntersecting) {
            monthVisible.set(key, entry.intersectionRatio || 0.01);
          } else {
            monthVisible.delete(key);
          }
        }
      }
    });
    update();
  }, {
    // Detect elements crossing near the top of the viewport.
    // rootMargin puts the effective "active zone" in the top 40% of the screen,
    // so the highlight changes as content scrolls past that area.
    rootMargin: "-80px 0px -60% 0px",
    threshold: [0, 0.25, 0.5, 0.75, 1],
  });

  document.querySelectorAll(".year-block").forEach(b => observer.observe(b));
  document.querySelectorAll(".month-anchor").forEach(b => observer.observe(b));

  currentScrollObserver = observer;

  // Seed initial state
  update();
}


function festivalTile(key, days) {
  // days come in reverse-chron from the outer sort; ensure chronological within the tile
  days = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const isExpanded = STATE.expandedFestivals.has(key);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const attended = days.length;
  const total = firstDay.festivalTotalDays || attended;

  const tile = el("div", { class: "festival-tile" });

  // Header: festival name + day count + expand/collapse
  const header = el("div", {
    class: "festival-header",
    on: { click: () => {
      if (isExpanded) STATE.expandedFestivals.delete(key);
      else STATE.expandedFestivals.add(key);
      renderTimeline();
    }}
  });

  // Collect unique headliners across all days (from openingActs, which for festivals
  // is actually the headline acts Seth noted)
  const allHeadliners = new Set();
  days.forEach(d => {
    if (d.openingActs) {
      d.openingActs.split(/,(?![^(]*\))/).forEach(h => {
        const trimmed = h.trim();
        if (trimmed) allHeadliners.add(trimmed);
      });
    }
  });

  const dateRange = days.length === 1
    ? formatDate(firstDay.date)
    : `${formatDate(firstDay.date)} – ${formatDate(lastDay.date)}`;

  header.appendChild(el("div", { class: "fest-badge" }, "FESTIVAL"));
  header.appendChild(el("div", { class: "fest-date" }, dateRange));
  header.appendChild(el("h3", { class: "fest-name" }, firstDay.festivalName || firstDay.artist));
  header.appendChild(el("div", { class: "fest-location" },
    [firstDay.venue, [firstDay.city, firstDay.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")
  ));
  header.appendChild(el("div", { class: "fest-attended" },
    `${attended} day${attended === 1 ? "" : "s"} attended`
  ));
  if (allHeadliners.size > 0) {
    const headlinerList = [...allHeadliners].slice(0, 6).join(" · ");
    const more = allHeadliners.size > 6 ? ` +${allHeadliners.size - 6} more` : "";
    header.appendChild(el("div", { class: "fest-headliners" }, "Featuring: " + headlinerList + more));
  }
  header.appendChild(el("div", { class: "fest-expand" }, isExpanded ? "▾ Collapse" : "▸ Show days"));

  tile.appendChild(header);

  if (isExpanded) {
    const dayList = el("div", { class: "fest-days" });
    days.forEach(d => {
      dayList.appendChild(festivalDayCard(d));
    });
    tile.appendChild(dayList);
  }

  return tile;
}

function festivalDayCard(c) {
  const dayNum = c.festivalDayNumber;
  const total = c.festivalTotalDays;

  return el("div", {
    class: "fest-day-card" + (c.hasPoster ? " has-poster" : ""),
    on: { click: () => openConcertModal(c) }
  },
    el("div", { class: "fest-day-num" }, `Day ${dayNum} of ${total}`),
    el("div", { class: "fest-day-date" }, formatDate(c.date), c.dayOfWeek ? " · " + c.dayOfWeek : ""),
    c.openingActs ? el("div", { class: "fest-day-acts" }, c.openingActs) : null,
    c.hasPoster ? el("div", { class: "fest-day-flag poster" }, "POSTER") : null,
  );
}

function concertCard(c) {
  const classes = ["concert-card"];
  if (c.hasPoster) classes.push("has-poster");

  const card = el("div", {
    class: classes.join(" "),
    on: { click: () => openConcertModal(c) }
  });

  // Inner wrapper for band thumb + text content
  const inner = el("div", { class: "cc-inner" });

  // Band thumbnail on the left (when we have an image)
  const bandInfo = bandLookup(c.artist);
  if (bandInfo && bandInfo.image_url) {
    inner.appendChild(bandThumb(c.artist, 72));
  } else {
    // For consistency, still show the initials placeholder
    inner.appendChild(bandThumb(c.artist, 72));
  }

  const textCol = el("div", { class: "cc-text" },
    el("div", { class: "cc-date" }, formatDate(c.date), c.dayOfWeek ? " · " + c.dayOfWeek : ""),
    el("h3", { class: "cc-artist" }, c.artist || "Unknown"),
    el("p", { class: "cc-venue" }, c.venue || ""),
    el("div", { class: "cc-location" }, [c.city, c.state].filter(Boolean).join(", ")),
    c.tourName && c.tourName !== "—" ? el("div", { class: "cc-tour" }, c.tourName) : null
  );
  inner.appendChild(textCol);
  card.appendChild(inner);

  // Show notes preview (if any)
  if (c.notes) {
    card.appendChild(el("div", { class: "cc-notes" }, `“${c.notes}”`));
  }

  // Bottom actions: setlist link
  if (c.setlistLink && c.setlistLink.startsWith("http")) {
    const actions = el("div", { class: "cc-actions" });
    actions.appendChild(el("a", {
      class: "cc-setlist",
      href: c.setlistLink,
      target: "_blank",
      rel: "noopener",
      title: "Open on setlist.fm",
      on: { click: e => e.stopPropagation() }
    }, "Setlist ↗"));
    card.appendChild(actions);
  }

  return card;
}

function updateParam(key, value) {
  const [path, qs] = (location.hash || "#/timeline").split("?");
  const params = new URLSearchParams(qs || "");
  if (!value || value === "") params.delete(key);
  else params.set(key, value);
  const newHash = path + (params.toString() ? "?" + params.toString() : "");
  location.hash = newHash;
}

// Debounced version for typing inputs: waits until the user stops typing
// before updating the URL, so the input keeps focus during rapid keystrokes.
// (Without this, every keystroke would re-render the entire view and destroy
// the input element, costing focus on each character.)
let _searchDebounceTimer = null;
function updateParamDebounced(key, value, delay = 250) {
  clearTimeout(_searchDebounceTimer);
  _searchDebounceTimer = setTimeout(() => updateParam(key, value), delay);
}

/**
 * Capture which form input has focus and its cursor position (if any) before
 * a re-render, then restore focus to the equivalent input after the re-render.
 * Called from router(); identifies inputs by their placeholder since that's
 * stable across renders in our tiny app.
 */
function withPreservedFocus(renderFn) {
  const active = document.activeElement;
  let snapshot = null;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
    snapshot = {
      placeholder: active.getAttribute("placeholder"),
      selectionStart: active.selectionStart,
      selectionEnd: active.selectionEnd,
      value: active.value,
    };
  }
  renderFn();
  if (snapshot && snapshot.placeholder) {
    const el = document.querySelector(`input[placeholder="${snapshot.placeholder}"]`);
    if (el) {
      el.focus();
      try {
        el.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
      } catch { /* ignore; some input types don't support selection */ }
    }
  }
}

/* ============================================================
   MAP VIEW
   ============================================================ */
let US_TOPO = null;

async function loadUsTopo() {
  if (US_TOPO) return US_TOPO;
  const res = await fetch("data/us-states.json");
  US_TOPO = await res.json();
  return US_TOPO;
}

async function renderMap() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  app.appendChild(el("div", { class: "view-header" },
    el("h2", { class: "view-title" }, "The ", el("span", { class: "accent" }, "road"), " so far"),
    el("p", { class: "view-sub" }, "States visited. Venues pinned. Click for details.")
  ));

  const past = STATE.concerts;  // already filtered
  const stateCount = {};
  past.forEach(c => { if (c.state) stateCount[c.state] = (stateCount[c.state] || 0) + 1; });

  const legend = el("div", { class: "map-legend" },
    el("span", {}, el("span", { class: "swatch", style: "background: var(--accent);" }), "Visited"),
    el("span", {}, el("span", { class: "swatch", style: "background: var(--ink);" }), "Never been"),
    el("span", {}, el("span", { class: "swatch", style: "background: var(--paper);" }), "Venue"),
  );

  const wrap = el("div", { class: "map-wrap" });
  wrap.appendChild(legend);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "us-map";
  svg.setAttribute("viewBox", "0 0 960 600");
  wrap.appendChild(svg);
  app.appendChild(wrap);

  const stateList = el("div", { class: "map-state-list" });
  const sortedStates = Object.entries(stateCount).sort((a, b) => b[1] - a[1]);
  sortedStates.forEach(([code, count]) => {
    const item = el("div", { class: "map-state-item" },
      el("span", { class: "state-name" }, STATE.stateNames[code] || code),
      el("span", { class: "state-count" }, count + " show" + (count === 1 ? "" : "s"))
    );
    item.addEventListener("click", () => {
      location.hash = "#/timeline?state=" + encodeURIComponent(code);
    });
    item.style.cursor = "pointer";
    stateList.appendChild(item);
  });
  app.appendChild(stateList);

  let tooltip = document.querySelector(".map-tooltip");
  if (!tooltip) {
    tooltip = el("div", { class: "map-tooltip" });
    document.body.appendChild(tooltip);
  }

  try {
    const topo = await loadUsTopo();
    const states = topojson.feature(topo, topo.objects.states);

    const projection = d3.geoAlbersUsa().fitSize([960, 600], states);
    const path = d3.geoPath(projection);
    const d3svg = d3.select(svg);
    const nameToCode = STATE.stateCodes;

    d3svg.append("g").selectAll("path")
      .data(states.features)
      .enter().append("path")
      .attr("class", f => {
        const code = nameToCode[(f.properties.name || "").toLowerCase()];
        return "state" + (code && stateCount[code] ? " visited" : "");
      })
      .attr("d", path)
      .on("mousemove", function(ev, f) {
        const code = nameToCode[(f.properties.name || "").toLowerCase()];
        const count = code ? (stateCount[code] || 0) : 0;
        tooltip.innerHTML = `<strong>${f.properties.name}</strong><br>${count} show${count === 1 ? "" : "s"}`;
        tooltip.style.display = "block";
        tooltip.style.left = (ev.clientX + 14) + "px";
        tooltip.style.top = (ev.clientY + 14) + "px";
      })
      .on("mouseleave", () => { tooltip.style.display = "none"; })
      .on("click", (ev, f) => {
        const code = nameToCode[(f.properties.name || "").toLowerCase()];
        if (code && stateCount[code]) {
          location.hash = "#/timeline?state=" + encodeURIComponent(code);
        }
      });

    const venueDots = aggregateVenues(past);
    const dotLayer = d3svg.append("g");
    venueDots.forEach(v => {
      const key = `${v.city.toLowerCase()},${(v.state || "").toLowerCase()}`;
      const ll = CITY_COORDS[key];
      if (!ll) return;
      const [x, y] = projection([ll[1], ll[0]]) || [null, null];
      if (x == null) return;
      const r = Math.max(4, Math.min(12, 3 + Math.sqrt(v.count) * 2));
      dotLayer.append("circle")
        .attr("class", "venue").attr("cx", x).attr("cy", y).attr("r", r)
        .on("mousemove", function(ev) {
          tooltip.innerHTML = `<strong>${v.venue}</strong><br>${v.city}, ${v.state}<br>${v.count} show${v.count === 1 ? "" : "s"}`;
          tooltip.style.display = "block";
          tooltip.style.left = (ev.clientX + 14) + "px";
          tooltip.style.top = (ev.clientY + 14) + "px";
        })
        .on("mouseleave", () => { tooltip.style.display = "none"; })
        .on("click", () => {
          location.hash = "#/timeline?q=" + encodeURIComponent(v.venue);
        });
    });
  } catch (e) {
    console.error(e);
    wrap.appendChild(el("div", { class: "loading" }, "Couldn't load US map. State list still works below."));
  }
}

function aggregateVenues(list) {
  const map = {};
  list.forEach(c => {
    if (!c.venue || !c.city) return;
    const k = c.venue + "||" + c.city + "||" + c.state;
    if (!map[k]) map[k] = { venue: c.venue, city: c.city, state: c.state, count: 0 };
    map[k].count++;
  });
  return Object.values(map);
}

/* ============================================================
   POSTER VIEW
   ============================================================ */
function renderPosters() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const params = new URLSearchParams((location.hash.split("?")[1] || ""));
  const q = params.get("q") || "";
  const artist = params.get("artist") || "";
  const type = params.get("type") || "";
  const autographed = params.get("autographed") === "1";
  const notAttended = params.get("notAttended") === "1";

  app.appendChild(el("div", { class: "view-header" },
    el("h2", { class: "view-title" }, "Paper ", el("span", { class: "accent" }, "artifacts")),
    el("p", { class: "view-sub" }, "Multiple posters from the same show are grouped together.")
  ));

  // Group posters by show (date + artist + location)
  const groupKey = p => `${p.date}||${(p.artist || "").toLowerCase()}||${(p.location || "").toLowerCase()}`;
  const groups = {};
  STATE.posters.forEach(p => {
    const k = groupKey(p);
    (groups[k] = groups[k] || []).push(p);
  });
  const groupList = Object.values(groups).map(list => ({
    date: list[0].date,
    year: list[0].year,
    artist: list[0].artist,
    location: list[0].location,
    attended: list[0].attended,
    posters: list.sort((a, b) => {
      // sort SE before AP before VIP for consistent display
      const order = { SE: 0, AP: 1, VIP: 2, Foil: 3 };
      return (order[classifyType(a.type)] || 9) - (order[classifyType(b.type)] || 9);
    }),
  }));

  // Filter UI
  const allArtists = [...new Set(groupList.map(g => g.artist).filter(Boolean))].sort();
  const allTypes = [...new Set(STATE.posters.map(p => classifyType(p.type)).filter(Boolean))].sort();

  const filterBar = el("div", { class: "filter-bar" });
  filterBar.appendChild(el("input", {
    type: "text", placeholder: "Search artist, illustrator, notes…", value: q,
    on: { input: e => updateParamDebounced("q", e.target.value) }
  }));

  const as = el("select", { on: { change: e => updateParam("artist", e.target.value) } });
  as.appendChild(el("option", { value: "" }, "All artists"));
  allArtists.forEach(a => {
    const o = el("option", { value: a }, a);
    if (a === artist) o.selected = true;
    as.appendChild(o);
  });
  filterBar.appendChild(as);

  const ts = el("select", { on: { change: e => updateParam("type", e.target.value) } });
  ts.appendChild(el("option", { value: "" }, "All types"));
  allTypes.forEach(t => {
    const o = el("option", { value: t }, t);
    if (t === type) o.selected = true;
    ts.appendChild(o);
  });
  filterBar.appendChild(ts);

  filterBar.appendChild(el("button", {
    class: "chip" + (autographed ? " active" : ""),
    on: { click: () => updateParam("autographed", autographed ? "0" : "1") }
  }, "Autographed"));

  filterBar.appendChild(el("button", {
    class: "chip" + (notAttended ? " active" : ""),
    on: { click: () => updateParam("notAttended", notAttended ? "0" : "1") }
  }, "Not attended"));

  const countEl = el("div", { class: "filter-count" });
  filterBar.appendChild(countEl);
  app.appendChild(filterBar);

  const qLower = q.toLowerCase();
  const filtered = groupList
    .map(g => {
      // When a filter is active that applies to individual posters (type, autographed),
      // trim the group's posters to only the matching ones. This makes the card
      // preview and modal show only what the filter asked for.
      let posters = g.posters;
      if (type) {
        posters = posters.filter(v => classifyType(v.type) === type);
      }
      if (autographed) {
        posters = posters.filter(v => v.autographed);
      }
      return posters.length === g.posters.length ? g : { ...g, posters };
    })
    .filter(g => {
      // Drop groups that now have zero matching posters
      if (g.posters.length === 0) return false;
      if (artist && g.artist !== artist) return false;
      if (notAttended && g.attended) return false;
      if (qLower) {
        const hay = [
          g.artist, g.location,
          ...g.posters.map(v => v.illustrator),
          ...g.posters.map(v => v.notes),
          ...g.posters.map(v => v.variant),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });

  filtered.sort((a, b) => b.date.localeCompare(a.date));
  const totalPosters = filtered.reduce((s, g) => s + g.posters.length, 0);
  countEl.textContent = `${filtered.length} show${filtered.length === 1 ? "" : "s"} · ${totalPosters} poster${totalPosters === 1 ? "" : "s"}`;

  // Poster marquee: a scrolling strip of poster thumbnails at the top of the view.
  // Uses the filtered set so it reflects whatever the user is currently looking at.
  // Inserted above the filter bar so it's the first visual thing you see.
  const marquee = buildPosterMarquee(filtered);
  if (marquee) {
    app.insertBefore(marquee, filterBar);
  }

  if (filtered.length === 0) {
    app.appendChild(el("div", { class: "loading" }, "No posters match these filters."));
    return;
  }

  // Group by year (matching timeline view)
  const byYear = {};
  filtered.forEach(g => {
    const y = g.year || (g.date ? new Date(g.date + "T00:00:00").getFullYear() : "Unknown");
    (byYear[y] = byYear[y] || []).push(g);
  });
  const years = Object.keys(byYear).sort((a, b) => b - a);

  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const yearMonthsMap = {};

  const wrap = el("div", { class: "timeline" });  // reuse timeline block styles
  years.forEach(year => {
    const block = el("div", { class: "year-block", id: `year-${year}` });
    const groupList = byYear[year];
    const posterCount = groupList.reduce((s, g) => s + g.posters.length, 0);

    block.appendChild(el("div", { class: "year-label" }, year));
    block.appendChild(el("div", { class: "year-meta" },
      `${groupList.length} show${groupList.length === 1 ? "" : "s"}` +
      (posterCount !== groupList.length ? ` · ${posterCount} posters` : "")
    ));

    // Group by month within year
    const byMonth = {};
    groupList.forEach(g => {
      const d = g.date;
      const month = d ? (new Date(d + "T00:00:00")).getMonth() : 0;
      (byMonth[month] = byMonth[month] || []).push(g);
    });
    const months = Object.keys(byMonth).sort((a, b) => b - a);  // Dec first
    yearMonthsMap[year] = months.map(Number);

    months.forEach(m => {
      const anchor = el("div", {
        id: `year-${year}-month-${m}`,
        class: "month-anchor"
      });
      block.appendChild(anchor);
      if (months.length > 1) {
        block.appendChild(el("div", { class: "month-sub" }, MONTH_NAMES[m]));
      }
      const grid = el("div", { class: "poster-grid" });
      byMonth[m].forEach(g => grid.appendChild(posterGroupCard(g)));
      block.appendChild(grid);
    });

    wrap.appendChild(block);
  });
  app.appendChild(wrap);

  // Floating jump-to-year menu (same one timeline uses)
  app.appendChild(buildYearJumpMenu(years, yearMonthsMap));
}

function posterImageSrc(p, which = "personal") {
  const override = STATE.posterOverrides[p.id] || {};
  if (which === "personal" && override.personalImage) return override.personalImage;
  if (which === "official" && override.officialImage) return override.officialImage;
  const csv = STATE.posterImages[p.id] || {};
  if (which === "personal" && csv.personal_url) return csv.personal_url;
  if (which === "official" && csv.official_url) return csv.official_url;
  const base = which === "personal" ? "images/personal/" : "images/official/";
  return base + `poster-${p.id}.jpg`;
}

/**
 * Scrolling marquee of poster thumbnails. Shows one thumb per poster-group
 * (primary variant) from the filtered set. Loops seamlessly by duplicating
 * the track content inline — once the first copy scrolls off, the second
 * copy is already in position.
 *
 * Clicking a thumbnail opens the poster modal for that show.
 * Hovering pauses the animation so the user can actually click what they see.
 *
 * Returns null if there are no posters with images to display (nothing to scroll).
 */
function buildPosterMarquee(groupList) {
  // Collect every group whose primary poster has a local image file (best-guess).
  // We don't know for certain if an image exists until we try to load it, so we
  // optimistically include all groups; any broken <img> will simply hide itself
  // via the onerror handler. This way the marquee stays full even if a few
  // images fail.
  if (!groupList || groupList.length === 0) return null;

  // Shuffle so the marquee feels curated rather than just newest-first.
  const shuffled = [...groupList].sort(() => Math.random() - 0.5);

  // Build a list of thumbnail elements. Each one is clickable and opens the
  // corresponding poster modal.
  const buildTile = (g) => {
    const primary = g.posters[0];
    const tries = [
      posterImageSrc(primary, "personal"),
      `images/personal/poster-${primary.id}.jpg`,
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    const tile = el("div", {
      class: "marquee-tile",
      title: `${g.artist} · ${formatDate(g.date)}`,
      on: { click: () => openPosterModal(g) }
    });

    let attempt = 0;
    const img = el("img", {
      src: tries[0] || "",
      alt: `${g.artist} poster`,
      loading: "lazy",
      on: {
        error: function() {
          attempt++;
          if (attempt < tries.length) {
            this.src = tries[attempt];
          } else {
            // Hide the whole tile if no image loads — keeps the marquee clean
            tile.style.display = "none";
          }
        }
      }
    });
    tile.appendChild(img);
    return tile;
  };

  const marquee = el("div", { class: "poster-marquee" });
  const track = el("div", { class: "marquee-track" });

  // Duplicate the content so it loops seamlessly. Animation slides -50%
  // (i.e. the full width of one copy) and then reuses the second copy
  // underneath without a visible jump.
  shuffled.forEach(g => track.appendChild(buildTile(g)));
  shuffled.forEach(g => track.appendChild(buildTile(g)));

  // Speed: constant pixels-per-second regardless of how many posters we have.
  // With ~40 posters per copy at ~200px wide = 8000px track → at 40px/sec = 200s per loop.
  // That's calm background motion, not frantic.
  const pxPerCopy = shuffled.length * 200;  // rough estimate
  const duration = Math.max(60, Math.round(pxPerCopy / 40));  // seconds, min 60s
  track.style.animationDuration = duration + "s";

  marquee.appendChild(track);
  return marquee;
}

function posterGroupCard(g) {
  const primary = g.posters[0];
  const thumb = el("div", { class: "poster-thumb" });

  const tries = [
    posterImageSrc(primary, "personal"),
    `images/personal/poster-${primary.id}.jpg`,
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let attempt = 0;
  const img = el("img", {
    src: tries[0] || "",
    alt: `${g.artist} poster`,
    loading: "lazy",
    on: {
      error: function() {
        attempt++;
        if (attempt < tries.length) {
          this.src = tries[attempt];
        } else {
          this.remove();
          thumb.appendChild(el("div", { class: "placeholder" }, "♪"));
        }
      }
    }
  });
  thumb.appendChild(img);

  // Multi-poster: show "X posters" badge AND a visual stack of ghost thumbnails behind the main one
  if (g.posters.length > 1) {
    thumb.appendChild(el("div", { class: "variant-count" }, `${g.posters.length} posters`));
    thumb.classList.add("multi-poster-thumb");
  }

  // "Not attended" flag
  if (!g.attended) {
    thumb.appendChild(el("div", { class: "not-attended-badge" }, "DIDN'T ATTEND"));
  }

  // Type + Variant badges
  const typesWrap = el("div", { class: "pi-types" });
  // Collect unique "Type · Variant" combos
  const typeVariantSet = new Set();
  g.posters.forEach(v => {
    const t = classifyType(v.type);
    if (t) typeVariantSet.add(t);
    if (v.variant) typeVariantSet.add(v.variant);
  });
  [...typeVariantSet].forEach(t => {
    const cls = ["SE", "AP", "VIP", "Foil"].includes(t) ? t : "Variant";
    typesWrap.appendChild(el("span", { class: `type-badge ${cls}` }, t));
  });

  const info = el("div", { class: "poster-info" },
    el("div", { class: "pi-date" }, formatDate(g.date)),
    el("h3", { class: "pi-artist" }, g.artist || "Unknown"),
    el("p", { class: "pi-loc" }, g.location || ""),
    typesWrap
  );

  const card = el("div", {
    class: "poster-group" + (g.attended ? "" : " not-attended"),
    on: { click: () => openPosterModal(g) }
  }, thumb, info);
  return card;
}

/* ============================================================
   STATS VIEW
   ============================================================ */
function renderStats() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  app.appendChild(el("div", { class: "view-header" },
    el("h2", { class: "view-title" }, "The ", el("span", { class: "accent" }, "numbers")),
    el("p", { class: "view-sub" }, "By the tally.")
  ));

  const past = STATE.concerts;  // already filtered at load time

  // Unique artists: every band we saw ANYWHERE — headliner, opener, or festival lineup.
  // Normalized so "The Mars Volta" and "Mars Volta" count as one.
  const uniqueArtistsMap = new Map();  // norm-key -> display name
  past.forEach(c => {
    allArtistsAtConcert(c).forEach(name => {
      const key = normalizeArtistKey(name);
      if (key && !uniqueArtistsMap.has(key)) {
        uniqueArtistsMap.set(key, name);
      }
    });
  });
  const uniqueArtists = uniqueArtistsMap;  // keep variable for length use below

  const uniqueVenues = new Set(past.map(c => c.venue).filter(Boolean));
  const uniqueStates = new Set(past.map(c => c.state).filter(Boolean));
  const uniqueFestivals = new Set(past.map(c => c.festivalKey).filter(Boolean));
  const firstYear = Math.min(...past.map(c => c.year));
  const lastYear = Math.max(...past.map(c => c.year));

  const grid = el("div", { class: "stats-grid" });
  [
    { label: "Shows attended", value: past.length, unit: "days logged" },
    { label: "Festivals", value: uniqueFestivals.size, unit: "multi-day events" },
    { label: "Unique artists", value: uniqueArtists.size, unit: "headliners + openers" },
    { label: "Unique venues", value: uniqueVenues.size },
    { label: "States visited", value: uniqueStates.size, unit: "of 50 + DC" },
    { label: "Posters", value: STATE.posters.length, unit: "collected" },
    { label: "Autographed", value: STATE.posters.filter(p => p.autographed).length, unit: "posters" },
    { label: "Years of live music", value: (lastYear - firstYear + 1), unit: `${firstYear} – ${lastYear}` },
  ].forEach(s => {
    grid.appendChild(el("div", { class: "stat-card" },
      el("p", { class: "stat-label" }, s.label),
      el("p", { class: "stat-value" }, String(s.value)),
      s.unit ? el("p", { class: "stat-unit" }, s.unit) : null
    ));
  });
  app.appendChild(grid);

  // Top artists: count every band we saw — headliner, opener, or festival lineup.
  // We normalize keys so "Mars Volta" and "The Mars Volta" count as one entry,
  // but display the most common version as the label.
  const artistCountByKey = {};   // norm-key -> count
  const artistDisplayByKey = {}; // norm-key -> {display-name: count-of-uses}
  past.forEach(c => {
    allArtistsAtConcert(c).forEach(name => {
      const key = normalizeArtistKey(name);
      if (!key) return;
      artistCountByKey[key] = (artistCountByKey[key] || 0) + 1;
      if (!artistDisplayByKey[key]) artistDisplayByKey[key] = {};
      artistDisplayByKey[key][name] = (artistDisplayByKey[key][name] || 0) + 1;
    });
  });
  // Pick most-common display name for each key
  const canonicalDisplay = key => {
    const variants = artistDisplayByKey[key] || {};
    let best = null, bestCount = -1;
    for (const [name, count] of Object.entries(variants)) {
      if (count > bestCount) { best = name; bestCount = count; }
    }
    return best || key;
  };
  const topArtists = Object.entries(artistCountByKey)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([key, count]) => [canonicalDisplay(key), count]);

  const twoCol = el("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;" });

  const artistList = el("div", { class: "top-list" },
    el("h3", {}, "Most-seen artists"),
    el("ol", {}, ...topArtists.map(([name, count], i) =>
      el("li", {
        on: { click: () => location.hash = "#/timeline?artist=" + encodeURIComponent(name) },
        style: "cursor:pointer;"
      },
        el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
        el("span", { class: "name" }, name),
        el("span", { class: "count" }, `${count}×`)
      )
    ))
  );
  twoCol.appendChild(artistList);

  const venueCount = {};
  past.forEach(c => {
    if (c.venue) {
      const key = c.venue + " — " + (c.city || "");
      venueCount[key] = (venueCount[key] || 0) + 1;
    }
  });
  const topVenues = Object.entries(venueCount)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const venueList = el("div", { class: "top-list" },
    el("h3", {}, "Most-visited venues"),
    el("ol", {}, ...topVenues.map(([name, count], i) =>
      el("li", {
        on: { click: () => location.hash = "#/timeline?q=" + encodeURIComponent(name.split(" — ")[0]) },
        style: "cursor:pointer;"
      },
        el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
        el("span", { class: "name" }, name),
        el("span", { class: "count" }, `${count}×`)
      )
    ))
  );
  twoCol.appendChild(venueList);
  app.appendChild(twoCol);

  // "Show buddies" — people I've attended shows with, by count
  const buddyCount = {};
  past.forEach(c => {
    splitAttendedWith(c.attendedWith).forEach(n => {
      buddyCount[n] = (buddyCount[n] || 0) + 1;
    });
  });
  const topBuddies = Object.entries(buddyCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  if (topBuddies.length > 0) {
    const buddyList = el("div", { class: "top-list" },
      el("h3", {}, "Show buddies"),
      el("ol", {}, ...topBuddies.map(([name, count], i) =>
        el("li", {
          on: { click: () => location.hash = "#/timeline?withPerson=" + encodeURIComponent(name) },
          style: "cursor:pointer;"
        },
          el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
          el("span", { class: "name" }, name),
          el("span", { class: "count" }, `${count} show${count === 1 ? "" : "s"}`)
        )
      ))
    );
    buddyList.style.marginTop = "24px";
    app.appendChild(buddyList);
  }

  // Year chart
  const yearCount = {};
  STATE.concerts.forEach(c => {
    if (c.year) yearCount[c.year] = (yearCount[c.year] || 0) + 1;
  });
  const years = Object.keys(yearCount).sort();
  const maxCount = Math.max(...Object.values(yearCount));

  const yearChart = el("div", { class: "year-chart" },
    el("h3", {}, "Shows per year")
  );
  const bars = el("div", { class: "year-bars" });
  years.forEach(y => {
    const count = yearCount[y];
    const pct = (count / maxCount) * 100;
    const bar = el("div", {
      class: "year-bar",
      style: `height:${pct}%;`,
      title: `${y}: ${count} shows`,
    },
      el("span", { class: "bar-count" }, String(count)),
      el("span", { class: "bar-year" }, y)
    );
    bars.appendChild(bar);
  });
  yearChart.appendChild(bars);
  app.appendChild(yearChart);
}

/* ============================================================
   MODAL INFRASTRUCTURE
   ============================================================ */
const modal = document.getElementById("modal");
const modalBody = modal.querySelector(".modal-body");
modal.querySelector(".modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", e => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  // Priority: close the topmost thing first. Lightbox > modal.
  if (closeLightbox()) return;
  closeModal();
});
function openModal() {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
}

/**
 * Lightbox for viewing a poster image at full size. Builds a full-screen
 * overlay once (lazily), reuses it on each open. The overlay dismisses when
 * the user clicks anywhere outside the image or presses Escape.
 *
 * Returns true if a lightbox was visible and is now closed (so the keydown
 * handler knows to NOT also close the parent modal).
 */
let _lightboxEl = null;
function openLightbox(src, alt) {
  if (!_lightboxEl) {
    _lightboxEl = el("div", {
      class: "lightbox",
      hidden: true,
      on: {
        click: (e) => {
          // Click anywhere in the overlay closes; but if the image itself
          // was clicked we still want the overlay to close (no zoom-on-zoom).
          closeLightbox();
        }
      }
    });
    const closeBtn = el("button", {
      class: "lightbox-close",
      "aria-label": "Close full-size view",
      on: { click: (e) => { e.stopPropagation(); closeLightbox(); } }
    }, "×");
    const img = el("img", { class: "lightbox-img", src: "", alt: "" });
    _lightboxEl.appendChild(closeBtn);
    _lightboxEl.appendChild(img);
    document.body.appendChild(_lightboxEl);
  }
  const img = _lightboxEl.querySelector(".lightbox-img");
  img.src = src;
  img.alt = alt || "";
  _lightboxEl.hidden = false;
}
function closeLightbox() {
  if (!_lightboxEl || _lightboxEl.hidden) return false;
  _lightboxEl.hidden = true;
  return true;
}

/* ============================================================
   CONCERT MODAL
   ============================================================ */
function openConcertModal(c) {
  // Fuzzy match posters to this concert
  const normalizeArtist = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/and/g, "");
  const dateDiffDays = (a, b) => Math.abs(
    (new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000
  );
  const editDist = (a, b) => {
    if (a === b) return 0;
    if (!a || !b) return Math.max((a||"").length, (b||"").length);
    if (a.length < b.length) [a, b] = [b, a];
    let prev = Array.from({length: b.length + 1}, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const cur = [i + 1];
      for (let j = 0; j < b.length; j++) {
        cur.push(Math.min(cur[j] + 1, prev[j + 1] + 1, prev[j] + (a[i] !== b[j] ? 1 : 0)));
      }
      prev = cur;
    }
    return prev[b.length];
  };
  const cArtist = normalizeArtist(c.artist);
  const shows = STATE.posters.filter(p => {
    if (dateDiffDays(p.date, c.date) > 4) return false;
    const pArtist = normalizeArtist(p.artist);
    if (!pArtist || !cArtist) return false;
    return pArtist.includes(cArtist) || cArtist.includes(pArtist)
        || editDist(pArtist, cArtist) <= 2;
  });

  modalBody.innerHTML = "";

  // Band banner at the top
  const bandInfo = bandLookup(c.artist);
  if (bandInfo || true) { // always show, even if it's a placeholder
    modalBody.appendChild(bandBanner(c.artist));
  }

  modalBody.appendChild(el("div", { class: "modal-eyebrow" },
    formatDate(c.date) + (c.dayOfWeek ? " · " + c.dayOfWeek : "") +
    (c.festivalKey ? ` · FESTIVAL · DAY ${c.festivalDayNumber} OF ${c.festivalTotalDays}` : "")
  ));
  modalBody.appendChild(el("h2", { class: "modal-title" }, c.artist || "Unknown"));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    [c.venue, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")
  ));

  // Band website/wiki chips
  if (bandInfo && (bandInfo.website_url || bandInfo.wiki_url)) {
    const bandLinks = el("div", { class: "band-links" });
    if (bandInfo.website_url) {
      bandLinks.appendChild(el("a", {
        class: "m-link", href: bandInfo.website_url, target: "_blank", rel: "noopener"
      }, "Official site ↗"));
    }
    if (bandInfo.wiki_url) {
      bandLinks.appendChild(el("a", {
        class: "m-link", href: bandInfo.wiki_url, target: "_blank", rel: "noopener"
      }, "Wikipedia ↗"));
    }
    modalBody.appendChild(bandLinks);
  }

  // Facts grid — for regular concerts, this holds opening acts.
  // For festival days, we render the lineup in a dedicated section below (richer format).
  const facts = el("div", { class: "modal-facts" });
  const factList = [
    c.tourName && !c.festivalKey && ["Tour", c.tourName],
    c.openingActs && !c.festivalKey && ["Opening acts", c.openingActs],
    c.attendedWith && ["Attended with", c.attendedWith],
  ].filter(Boolean);
  factList.forEach(([label, val]) => {
    facts.appendChild(el("div", { class: "fact" },
      el("div", { class: "fact-label" }, label),
      el("div", { class: "fact-value" }, val)
    ));
  });
  if (factList.length) modalBody.appendChild(facts);

  // Festival Lineup: dedicated section with headliners vs. supporting acts.
  // Top 2 acts get pulled out as "Headliners", everyone else as "Supporting Acts".
  if (c.festivalKey && c.openingActs) {
    const lineup = splitActs(c.openingActs);
    if (lineup.length) {
      const block = el("div", { class: "festival-lineup" });
      block.appendChild(el("h4", { class: "lineup-title" }, "Festival Lineup"));

      const headliners = lineup.slice(0, 2);
      const supporting = lineup.slice(2);

      if (headliners.length) {
        const hrow = el("div", { class: "lineup-section" });
        hrow.appendChild(el("div", { class: "lineup-label" }, "Headliners"));
        const chipWrap = el("div", { class: "lineup-chips headliners-chips" });
        headliners.forEach(h => chipWrap.appendChild(el("span", { class: "lineup-chip headliner" }, h)));
        hrow.appendChild(chipWrap);
        block.appendChild(hrow);
      }

      if (supporting.length) {
        const srow = el("div", { class: "lineup-section" });
        srow.appendChild(el("div", { class: "lineup-label" }, "Supporting Acts"));
        const chipWrap = el("div", { class: "lineup-chips" });
        supporting.forEach(s => chipWrap.appendChild(el("span", { class: "lineup-chip" }, s)));
        srow.appendChild(chipWrap);
        block.appendChild(srow);
      }

      modalBody.appendChild(block);
    }
  }

  // Show notes (callout style)
  if (c.notes) {
    modalBody.appendChild(el("div", { class: "notes-block" },
      el("div", { class: "notes-label" }, "Show Notes"),
      el("div", { class: "notes-body" }, c.notes)
    ));
  }

  // Posters
  if (shows.length) {
    modalBody.appendChild(el("div", { class: "poster-variants" },
      el("h4", {}, shows.length > 1 ? `${shows.length} posters from this show` : "Poster from this show"),
      el("div", { class: "variant-list" }, ...shows.map(variantBlock))
    ));
  }

  // Setlist (from pre-fetched cache)
  const setlist = setlistForConcert(c);
  if (setlist && setlist.sets && setlist.sets.length) {
    modalBody.appendChild(renderSetlistBlock(setlist));
  }

  // Action links
  const links = el("div", { class: "modal-links" });
  if (c.setlistLink && c.setlistLink.startsWith("http")) {
    links.appendChild(el("a", { class: "m-link accent-link", href: c.setlistLink, target: "_blank", rel: "noopener" }, "Setlist.fm ↗"));
  }
  if (c.state) {
    links.appendChild(el("a", { class: "m-link", href: "#/timeline?state=" + encodeURIComponent(c.state) },
      "More from " + (STATE.stateNames[c.state] || c.state)));
  }
  if (c.artist && !c.festivalKey) {
    links.appendChild(el("a", { class: "m-link", href: "#/timeline?artist=" + encodeURIComponent(c.artist) },
      "More " + c.artist));
  }
  if (links.children.length) modalBody.appendChild(links);

  openModal();
}

/* ============================================================
   POSTER MODAL
   ============================================================ */
function openPosterModal(group) {
  modalBody.innerHTML = "";
  modalBody.appendChild(el("div", { class: "modal-eyebrow" },
    formatDate(group.date) + (group.attended ? "" : " · NOT ATTENDED")
  ));
  modalBody.appendChild(el("h2", { class: "modal-title" }, group.artist || "Unknown"));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    group.location || ""
  ));

  modalBody.appendChild(el("div", { class: "poster-variants" },
    el("h4", {}, group.posters.length > 1
      ? `${group.posters.length} posters from this show`
      : "The poster"),
    el("div", { class: "variant-list" }, ...group.posters.map(variantBlock))
  ));

  // Back-link to concert
  const normalizeArtist = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/and/g, "");
  const dateDiffDays = (a, b) => Math.abs(
    (new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000
  );
  const gArtist = normalizeArtist(group.artist);
  const c = STATE.concerts.find(x => {
    if (dateDiffDays(x.date, group.date) > 4) return false;
    const xArtist = normalizeArtist(x.artist);
    return xArtist && gArtist && (xArtist.includes(gArtist) || gArtist.includes(xArtist));
  });
  const links = el("div", { class: "modal-links" });
  if (c) {
    links.appendChild(el("a", { class: "m-link", href: "#", on: { click: e => {
      e.preventDefault();
      openConcertModal(c);
    }}}, "View show details"));
  }
  if (links.children.length) modalBody.appendChild(links);

  openModal();
}

function variantBlock(p) {
  const typeClass = classifyType(p.type);
  const wrap = el("div", { class: "variant" });

  // Images section: MVP shows the user's personal photo only.
  const imageCol = el("div", { class: "variant-images" });
  const imgHolder = el("div", { class: "variant-image" });

  function showImage(which) {
    imgHolder.innerHTML = "";
    const primarySrc = posterImageSrc(p, which);
    const fallbackFile = `images/${which}/poster-${p.id}.jpg`;
    const img = el("img", {
      src: primarySrc,
      alt: `${p.artist} poster`,
      loading: "lazy",
      title: "Click to view full size",
      on: {
        click: function() {
          // Use this.src (the actual working URL after any fallback) not primarySrc
          if (this.src && !this.dataset.broken) {
            openLightbox(this.src, `${p.artist} poster`);
          }
        },
        error: function() {
          if (!this.dataset.triedLocal) {
            this.dataset.triedLocal = "1";
            this.src = fallbackFile;
            return;
          }
          this.dataset.broken = "1";
          imgHolder.innerHTML = "";
          const hint = `No photo yet.<br>Add to <code>data/poster_images.csv</code>,<br>drop <code>images/personal/poster-${p.id}.jpg</code>,<br>or paste a URL below.`;
          imgHolder.appendChild(el("div", { class: "no-img", html: hint }));
          imgHolder.appendChild(el("button", {
            class: "v-link",
            style: "margin-top:8px;background:transparent;cursor:pointer;",
            on: { click: () => promptForImageUrl(p, which, () => showImage(which)) }
          }, "Paste URL"));
        }
      }
    });
    img.classList.add("clickable-poster");
    imgHolder.appendChild(img);
  }

  // MVP: only show personal images. Official tab has been removed until we
  // have a programmatic way to find stock images. No tab row needed when
  // there's only one view.
  imageCol.appendChild(imgHolder);
  wrap.appendChild(imageCol);
  setTimeout(() => showImage("personal"), 0);

  // Info
  const info = el("div", { class: "variant-info" });

  // Title line: Type + Variant badges
  const titleLine = el("div", { class: "v-type" });
  titleLine.appendChild(document.createTextNode(p.type || "Poster"));
  // Type badge (if classified)
  if (typeClass) {
    titleLine.appendChild(el("span", {
      class: `type-badge ${typeClass}`,
      style: "margin-left:8px;vertical-align:middle;"
    }, typeClass));
  }
  // Variant badge (separate!)
  if (p.variant) {
    titleLine.appendChild(el("span", {
      class: "type-badge Variant",
      style: "margin-left:4px;vertical-align:middle;"
    }, p.variant));
  }
  info.appendChild(titleLine);

  if (p.illustrator) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Artist: "), p.illustrator));
  if (p.number) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Edition: "), p.number));
  if (p.tourShowSpecific) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Scope: "), p.tourShowSpecific));
  const flags = [];
  if (p.autographed) flags.push("Autographed");
  if (p.framed) flags.push("Framed");
  if (!p.attended) flags.push("Not attended");
  if (flags.length) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Flags: "), flags.join(" · ")));

  // Poster notes
  if (p.notes) {
    info.appendChild(el("div", { class: "v-notes" }, `“${p.notes}”`));
  }

  // Expressobeans link
  const vlinks = el("div", { class: "v-links" });
  if (p.expressobeansLink && p.expressobeansLink.startsWith("http")) {
    vlinks.appendChild(el("a", {
      class: "v-link", href: p.expressobeansLink, target: "_blank", rel: "noopener"
    }, "Expressobeans ↗"));
  }
  if (vlinks.children.length) info.appendChild(vlinks);

  wrap.appendChild(info);
  return wrap;
}

function promptForImageUrl(p, which, onSuccess) {
  const current = (STATE.posterOverrides[p.id] || {})[which + "Image"] || "";
  const url = prompt(
    `Paste an image URL for the ${which === "personal" ? "MINE" : "OFFICIAL"} view of this poster.\n\n` +
    "Leave blank to clear.",
    current
  );
  if (url === null) return;
  STATE.posterOverrides[p.id] = STATE.posterOverrides[p.id] || {};
  if (url.trim() === "") {
    delete STATE.posterOverrides[p.id][which + "Image"];
  } else {
    STATE.posterOverrides[p.id][which + "Image"] = url.trim();
  }
  saveOverrides();
  onSuccess();
}

/* ============================================================
   INIT
   ============================================================ */
(async function init() {
  try {
    await loadData();
    window.addEventListener("hashchange", router);
    if (!window.location.hash) window.location.hash = "#/timeline";
    router();
  } catch (e) {
    console.error(e);
    document.getElementById("app").innerHTML =
      `<div class="loading">Failed to load data. ${e.message}</div>`;
  }
})();
