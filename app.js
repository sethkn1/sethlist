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
    stock: h.indexOf("stock_url"),
    official: h.indexOf("official_url"),
  };
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const pid = parseInt(cols[idx.id], 10);
    if (Number.isNaN(pid)) continue;
    out[pid] = {
      personal_url: (cols[idx.personal] || "").trim() || null,
      stock_url: idx.stock >= 0 ? ((cols[idx.stock] || "").trim() || null) : null,
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
  "#/songs": renderSongs,
  "#/stats": renderStats,
  "#/about": renderAbout,
};

function router() {
  let hash = window.location.hash || "#/timeline";
  const [path, queryStr] = hash.split("?");
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

  // Deep-link: if the URL contains ?modal=<id>, open the appropriate modal
  // after the view renders. Uses a small delay so the render completes first.
  const params = new URLSearchParams(queryStr || "");
  const modalId = params.get("modal");
  if (modalId !== null && modal.hidden) {
    setTimeout(() => openModalFromDeepLink(path, modalId), 50);
  }

  // Auto-launch screensaver mode when ?autoscreensaver=1 is in the URL.
  // This exists specifically so macOS screensaver wrappers like
  // WebViewScreenSaver can point at a single URL and get fullscreen rotation
  // with zero interaction. We wait a bit longer than the modal deep-link to
  // let posters.json and images load.
  if (params.get("autoscreensaver") === "1" && _screensaverEl?.hidden !== false) {
    // Wait for data and render to settle before starting
    setTimeout(() => {
      if (STATE.posters && STATE.posters.length > 0) {
        startScreensaver();
      } else {
        // Data still loading — retry once more after a longer delay
        setTimeout(() => {
          if (STATE.posters && STATE.posters.length > 0) startScreensaver();
        }, 1500);
      }
    }, 400);
  }
}

/**
 * Resolve and open a modal based on the current route and modal id from the URL.
 * Concert modals on Timeline; poster modals on Posters view. If the id matches
 * neither, silently no-op (clears the stale param).
 */
function openModalFromDeepLink(route, modalId) {
  const id = parseInt(modalId, 10);
  if (isNaN(id)) return;

  if (route === "#/posters") {
    // Find a poster group whose primary poster has this id
    const list = STATE._posterNavList || [];
    const idx = list.findIndex(g => g.posters && g.posters[0] && g.posters[0].id === id);
    if (idx >= 0) openPosterModal(list[idx], { list, index: idx });
  } else if (route === "#/timeline" || route === "") {
    const list = STATE._timelineNavList || [];
    const idx = list.findIndex(c => c.id === id);
    if (idx >= 0) openConcertModal(list[idx], { list, index: idx });
  }
  // Songs view etc. don't deep-link to modals (yet)
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
 * Build the cache key used in setlists.json for opener entries.
 * Must match prefetch_setlists.py's opener_cache_key() exactly.
 */
function openerCacheKey(artistName, dateIso) {
  const slug = (artistName || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `opener:${slug}:${dateIso}`;
}

/**
 * Look up an opener's setlist for a specific show. Returns null if not cached
 * or if the cached entry is an error (e.g. "no match on setlist.fm").
 */
function openerSetlistFor(artistName, dateIso) {
  const key = openerCacheKey(artistName, dateIso);
  const entry = STATE.setlists[key];
  if (!entry || entry._error) return null;
  return entry;
}

/**
 * Yield every song-performance in every cached setlist, as
 * {artist, song, date, role}. Used by stats aggregation.
 *
 * Skips entries with errors, skips songs played on tape (those weren't
 * actually performed), and normalizes artist name to what's stored in the
 * setlist entry (which is the canonical setlist.fm version).
 */
function* iterAllSongPerformances() {
  // Build a lookup: setlist-key -> concert, so each performance can point back
  // to the show it came from. Headliner entries are keyed by setlist-id; opener
  // entries are keyed by "opener:artist-slug:YYYY-MM-DD".
  if (!STATE._concertByKey) {
    const idx = new Map();
    for (const c of STATE.concerts) {
      const sid = extractSetlistId(c.setlistLink);
      if (sid) idx.set(sid, c);
      // Openers: for each named opener, map the slug-key back to the concert
      for (const opener of splitActs(c.openingActs)) {
        idx.set(openerCacheKey(opener, c.date), c);
      }
    }
    STATE._concertByKey = idx;
  }

  for (const [key, entry] of Object.entries(STATE.setlists || {})) {
    if (!entry || entry._error) continue;
    const artist = entry.artist || "(unknown)";
    // Convert setlist.fm's DD-MM-YYYY → app's YYYY-MM-DD for consistent sorting/linking
    let dateIso = null;
    if (entry.eventDate && /^\d{2}-\d{2}-\d{4}$/.test(entry.eventDate)) {
      const [d, m, y] = entry.eventDate.split("-");
      dateIso = `${y}-${m}-${d}`;
    }
    const concert = STATE._concertByKey.get(key) || null;

    for (const s of entry.sets || []) {
      for (const song of s.songs || []) {
        if (!song.name) continue;
        if (song.tape) continue;  // tape intro / interlude, not a live performance
        yield {
          artist,
          song: song.name,
          date: dateIso,
          role: entry.role || "headliner",
          cover: song.cover || null,
          concert,          // full concert object for linking back
          setlistUrl: entry.url || null,  // setlist.fm URL if we want to link out
        };
      }
    }
  }
}

/**
 * Render a setlist block from the pre-fetched cache.
 * Shows each set in order; encores get "Encore" label. Songs are numbered
 * continuously. Covers and tape intros get small annotations inline.
 *
 * Options:
 *   subtitle — override the "Setlist" title with a custom string (e.g.,
 *              "The Mars Volta · opener" for opener setlists in a show modal).
 */
function renderSetlistBlock(setlist, options = {}) {
  const block = el("div", { class: "setlist-block" });
  const titleText = options.subtitle || "Setlist";
  block.appendChild(el("h4", { class: "setlist-title" }, titleText));
  if (setlist.tour && !setlist.tour.match(/^[\s\-—]*$/)) {
    block.appendChild(el("div", { class: "setlist-tour" }, setlist.tour));
  }

  // Derive the year from the event date (DD-MM-YYYY) — used in the YouTube
  // search query to anchor results to roughly the right era. Helps when a
  // band has been playing the same song for 30 years.
  const yearStr = (() => {
    const d = setlist.eventDate || "";
    const m = d.match(/\d{4}$/);
    return m ? m[0] : "";
  })();

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

      // YouTube search link — skipped for tape intros (there's nothing to watch).
      // Opens in a new tab with a pre-built query like:
      //   "Tool Schism live 2024"
      // YouTube's own search does the rest; no API, no data storage.
      if (!song.tape && song.name && setlist.artist) {
        const searchQuery = `${setlist.artist} ${song.name} live${yearStr ? " " + yearStr : ""}`;
        const ytUrl = "https://www.youtube.com/results?search_query=" +
          encodeURIComponent(searchQuery);
        li.appendChild(el("a", {
          class: "song-yt-link",
          href: ytUrl,
          target: "_blank",
          rel: "noopener",
          title: `Search YouTube for "${setlist.artist} ${song.name} live"`,
          "aria-label": "Search YouTube for this song",
          // Stop click propagation so if the setlist-song ever becomes clickable
          // (unrelated handler), the YT link still opens cleanly.
          on: { click: (e) => e.stopPropagation() }
        }, "▶"));
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
 * Build a compact "On this day" block: any concerts whose month+day match
 * the given date (or today's, by default) from previous years. Returns null
 * if no matches — Timeline calls this and only renders if non-null.
 *
 * @param {string} [overrideMonthDay] - "MM-DD" format. If provided, shows
 *        matches for that calendar date instead of today's. Used when a
 *        URL has ?date=MM-DD for shareable links to a historical day.
 *
 * Shows up to 4 matches — beyond that, space gets cramped. If more exist,
 * a small "+N more" hint is shown. Each entry is clickable → concert modal.
 */
function buildOnThisDayBlock(overrideMonthDay) {
  const today = new Date();
  // Honor override but validate format strictly. Accepts "MM-DD" with
  // 2-digit months 01-12 and days 01-31. Anything else falls back to today.
  let monthDay = overrideMonthDay && /^\d{2}-\d{2}$/.test(overrideMonthDay)
    ? overrideMonthDay
    : null;
  if (monthDay) {
    const [mm, dd] = monthDay.split("-").map(Number);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) monthDay = null;
  }
  if (!monthDay) {
    monthDay = String(today.getMonth() + 1).padStart(2, "0") + "-" +
               String(today.getDate()).padStart(2, "0");
  }
  const isToday = monthDay === (
    String(today.getMonth() + 1).padStart(2, "0") + "-" +
    String(today.getDate()).padStart(2, "0")
  );
  const currentYear = today.getFullYear();

  // Filter: non-future concerts whose date's MM-DD matches the target date.
  // If we're showing "today" specifically, exclude the current year (since
  // that show would already be visible in the year block below). For
  // explicitly-requested dates via URL, include the current year too — the
  // user is asking to see all years.
  const matches = STATE.concerts.filter(c => {
    if (!c.date) return false;
    if (isToday && c.year === currentYear) return false;
    return c.date.slice(5) === monthDay;
  }).sort((a, b) => b.date.localeCompare(a.date));  // newest first

  if (matches.length === 0) return null;

  // Build a Date object for label formatting (use a non-leap year so 02-29
  // formats correctly as "February 29")
  const [mm, dd] = monthDay.split("-").map(Number);
  const labelDate = new Date(2024, mm - 1, dd);
  const monthName = labelDate.toLocaleDateString("en-US", { month: "long" });
  const dayNum = dd;

  const block = el("div", { class: "on-this-day" });
  block.appendChild(el("div", { class: "otd-header" },
    el("span", { class: "otd-label" },
      (isToday ? "On this day · " : "On ") + monthName + " " + dayNum),
    el("span", { class: "otd-count" },
      matches.length + " show" + (matches.length === 1 ? "" : "s") +
      (isToday ? " in previous years" : " across the years"))
  ));

  const displayed = matches.slice(0, 4);
  const cardRow = el("div", { class: "otd-cards" });
  displayed.forEach(c => {
    const yearsAgo = currentYear - c.year;
    const card = el("div", {
      class: "otd-card",
      on: { click: () => openConcertModal(c) }
    },
      el("div", { class: "otd-years" },
        isToday
          ? yearsAgo + " year" + (yearsAgo === 1 ? "" : "s") + " ago"
          : String(c.year)
      ),
      el("div", { class: "otd-year" }, String(c.year)),
      el("div", { class: "otd-artist" }, c.artist || "Unknown"),
      el("div", { class: "otd-venue" },
        [c.venue, c.city].filter(Boolean).join(" · "))
    );
    cardRow.appendChild(card);
  });
  block.appendChild(cardRow);

  if (matches.length > displayed.length) {
    block.appendChild(el("div", { class: "otd-more" },
      "+" + (matches.length - displayed.length) + " more on " + monthName + " " + dayNum));
  }

  return block;
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
 * Headliner-only artists at a concert. For festival rows, returns nothing
 * (the "headliner" is the festival itself, not a band). For regular shows,
 * returns the top-billed band only.
 */
function headlinerAtConcert(c) {
  if (c.festivalKey) return [];
  return c.artist ? [c.artist] : [];
}

/**
 * Opener-only artists at a concert. For regular shows, this is the
 * supporting acts (the bands listed under the headliner). For festival
 * rows, all bands listed are equivalent — we treat them all as openers
 * because no single band was the festival's "headliner" in the user's
 * personal experience (multiple stages, multi-day, etc.).
 */
function openersAtConcert(c) {
  return splitActs(c.openingActs);
}

/**
 * Return artists at a concert filtered by role: "all", "headliner", "opener".
 */
function artistsAtConcertByRole(c, role) {
  if (role === "headliner") return headlinerAtConcert(c);
  if (role === "opener") return openersAtConcert(c);
  return allArtistsAtConcert(c);
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
  const venue = params.get("venue") || "";  // deep-link target for "More at [Venue]"
  const tour = params.get("tour") || "";    // deep-link target for "Tour: ..." link in concert modal
  // Poster filter: 3-state dropdown (all / with poster / without poster).
  // Uses URL param `poster` ("yes"|"no"|""). Backward-compatible with the
  // legacy `posterOnly=1` param used by older shared links.
  const posterFilter = (() => {
    const v = (params.get("poster") || "").toLowerCase();
    if (v === "yes" || v === "no") return v;
    if (params.get("posterOnly") === "1") return "yes";
    return "";
  })();
  const festival = params.get("festival") || ""; // festivalKey to focus on
  // Optional MM-DD param: when present, show the "On this day" block scoped
  // to that calendar date instead of today's. Used for shareable historical-
  // date links like /#/timeline?date=07-14
  const overrideDate = params.get("date") || "";
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

  // "On this day" — shows that match today's (or specified) month+day across
  // years. Behavior depends on URL state:
  //   - No ?date param + no other filters → show today's matches if any exist
  //   - No ?date param + filters active → suppress (would clash with filter focus)
  //   - ?date=MM-DD set → ALWAYS show, regardless of filters (user explicitly
  //     asked for this date, so we honor it)
  const hasAnyFilter = q || state || artist || venue || posterFilter || festival ||
    attendedWithFilter.length > 0;
  if (overrideDate || !hasAnyFilter) {
    const otdBlock = buildOnThisDayBlock(overrideDate || undefined);
    if (otdBlock) app.appendChild(otdBlock);
  }

  // Build filters
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

  // Build the unique list of festivals from concert data, preserving each
  // festival's most-readable display name (we strip "- Day N" suffixes since
  // the filter selects the whole festival, not a specific day). Track the
  // earliest date per festival so we can present the dropdown in chronological
  // order, oldest first — matches how the user thinks about their concert
  // history (1999 → present).
  const festivalsMap = new Map();  // festivalKey -> { name, earliestDate }
  STATE.concerts.forEach(c => {
    if (!c.festivalKey) return;
    if (festivalsMap.has(c.festivalKey)) {
      // Update earliestDate if this concert is earlier
      const existing = festivalsMap.get(c.festivalKey);
      if (c.date && (!existing.earliestDate || c.date < existing.earliestDate)) {
        existing.earliestDate = c.date;
      }
      return;
    }
    // Reconstruct name from key: rock_on_the_range_2018 → "Rock on the Range 2018"
    const name = c.festivalKey
      .split("_")
      .map(w => /^\d{4}$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))
      .join(" ");
    festivalsMap.set(c.festivalKey, { name, earliestDate: c.date || "" });
  });
  // Sort by earliest date ascending (oldest first). Festivals without a
  // resolvable date sort last alphabetically as a fallback.
  const allFestivals = [...festivalsMap.entries()].sort((a, b) => {
    const da = a[1].earliestDate || "9999-99-99";
    const db = b[1].earliestDate || "9999-99-99";
    if (da !== db) return da.localeCompare(db);
    return a[1].name.localeCompare(b[1].name);
  });

  const festivalSelect = el("select", {
    on: { change: e => updateParam("festival", e.target.value) }
  });
  festivalSelect.appendChild(el("option", { value: "" }, "All festivals"));
  allFestivals.forEach(([key, info]) => {
    const opt = el("option", { value: key }, info.name);
    if (key === festival) opt.selected = true;
    festivalSelect.appendChild(opt);
  });
  filterBar.appendChild(festivalSelect);

  const artistSelect = el("select", {
    on: { change: e => updateParam("artist", e.target.value) }
  });
  artistSelect.appendChild(el("option", { value: "" }, "All bands"));
  allArtists.forEach(a => {
    const opt = el("option", { value: a }, a);
    if (a === artist) opt.selected = true;
    artistSelect.appendChild(opt);
  });
  filterBar.appendChild(artistSelect);

  // Attended With multi-select popover
  filterBar.appendChild(attendedWithPopover(allNames, nameCounts, attendedWithFilter));

  const posterSelect = el("select", {
    on: { change: e => {
      // When user picks a value, also clear the legacy posterOnly param to
      // avoid the two params fighting on URL reload.
      const [route, queryStr] = (location.hash || "#/timeline").split("?");
      const p = new URLSearchParams(queryStr || "");
      const v = e.target.value;
      if (v) p.set("poster", v); else p.delete("poster");
      p.delete("posterOnly");
      const newHash = route + (p.toString() ? "?" + p.toString() : "");
      location.hash = newHash;
    }}
  });
  [
    ["", "With or Without Poster"],
    ["yes", "With Poster"],
    ["no", "Without Poster"]
  ].forEach(([val, label]) => {
    const opt = el("option", { value: val }, label);
    if (val === posterFilter) opt.selected = true;
    posterSelect.appendChild(opt);
  });
  filterBar.appendChild(posterSelect);

  // Reset link: visible whenever any Timeline filter is active.
  const anyTimelineFilter = q || artist || venue || tour || festival ||
    posterFilter || attendedWithFilter.length > 0;
  if (anyTimelineFilter) {
    filterBar.appendChild(el("button", {
      class: "filter-reset-link",
      title: "Clear all filters",
      on: { click: () => { location.hash = "#/timeline"; } }
    }, "Reset"));
  }

  const countEl = el("div", { class: "filter-count" });
  filterBar.appendChild(countEl);
  app.appendChild(filterBar);

  // Filter
  const qLower = q.toLowerCase();
  let filtered = STATE.concerts.filter(c => {
    if (state && c.state !== state) return false;
    if (artist && c.artist !== artist) return false;
    if (venue && c.venue !== venue) return false;
    if (tour && c.tourName !== tour) return false;
    if (festival && c.festivalKey !== festival) return false;
    if (posterFilter === "yes" && !c.hasPoster) return false;
    if (posterFilter === "no" && c.hasPoster) return false;
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

  // Stash the filtered list on STATE so click handlers can build nav context for arrow-key nav.
  // We store only concerts (not festival-level grouping) — arrow-nav walks individual shows.
  STATE._timelineNavList = filtered;

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
    on: { click: () => openConcertModalWithNav(c) }
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
    on: { click: () => openConcertModalWithNav(c) }
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
  const q = params.get("q") || "";  // legacy: free-text search box was removed but param still respected for shareable links
  const artist = params.get("artist") || "";
  const illustrator = params.get("illustrator") || "";  // poster artist (e.g., Don Pendleton)
  const type = params.get("type") || "";
  const autographed = params.get("autographed") === "1";
  const framedOnly = params.get("framed") === "1";  // chip toggle: framed posters only
  const festivalOnly = params.get("festival") === "1";  // chip toggle: festival-related posters
  const notAttended = params.get("notAttended") === "1";

  // View header: title on the left, action buttons (Random / Screensaver) on the right.
  // The action buttons live here (not in the filter bar) because they're page-level
  // primary actions rather than filter controls.
  const header = el("div", { class: "view-header view-header-split" });
  const headerText = el("div", { class: "view-header-text" },
    el("h2", { class: "view-title" }, "Paper ", el("span", { class: "accent" }, "artifacts")),
    el("p", { class: "view-sub" }, "In the era of digital ticket stubs, Seth's collection of Posters are physical momentos during his journey to #rawk")
  );
  const headerActions = el("div", { class: "view-header-actions" });
  // Buttons are added later, after `filtered` is computed, so they can use it.
  header.appendChild(headerText);
  header.appendChild(headerActions);
  app.appendChild(header);

  // Group posters by show AND by print identity. A "print" is the unique
  // poster art — two physical copies of the same numbered edition (one
  // autographed, one not, or numbers 14/250 and 15/250) are still the same
  // print. But VIP vs SE, or SE numbered /350 vs SE Unnumbered, are
  // different prints and should be displayed as separate tiles.
  //
  // Rule: same group when date + artist + location + type + variant + denominator
  //       all match. "Denominator" is the part after "/" in "224/500"; an
  //       unrecorded number ("Unknown") is treated as matching any denominator
  //       within the same type+variant (since the user knows which print it
  //       belongs to even if they didn't write the number down). "Unnumbered"
  //       is treated as a distinct edition class — a numbered run and an
  //       unnumbered run are different prints even of the same type/variant.
  function denominatorKey(p) {
    const num = (p.number || "").toString().trim();
    if (!num) return "_blank";
    if (/^unknown$/i.test(num)) return "_unknown";  // matches any denom in same type/variant
    if (/^unnumbered$/i.test(num)) return "_unnumbered";  // distinct edition class
    const m = num.match(/\/(\d+)/);
    if (m) return "denom:" + m[1];
    return "raw:" + num.toLowerCase();
  }
  function groupKey(p) {
    const dateArtLoc = `${p.date}||${(p.artist || "").toLowerCase()}||${(p.location || "").toLowerCase()}`;
    const type = (p.type || "").toLowerCase();
    const variant = (p.variant || "").toLowerCase();
    return `${dateArtLoc}||${type}||${variant}||${denominatorKey(p)}`;
  }

  // First-pass grouping by full key
  const byKey = {};
  STATE.posters.forEach(p => {
    const k = groupKey(p);
    (byKey[k] = byKey[k] || []).push(p);
  });

  // Second pass: within a single show (date+artist+location), if a group has
  // a `_unknown` denominator and there's exactly one OTHER group with the same
  // type+variant, merge them — the "Unknown" copy belongs to that print.
  // (We skip the merge if the only other group is `_unnumbered`, since Unknown
  // most likely refers to a numbered edition and shouldn't collapse into the
  // unnumbered run.)
  const showKey = p => `${p.date}||${(p.artist || "").toLowerCase()}||${(p.location || "").toLowerCase()}`;
  const showGroups = {};
  Object.entries(byKey).forEach(([k, list]) => {
    const sk = showKey(list[0]);
    (showGroups[sk] = showGroups[sk] || []).push({ key: k, posters: list });
  });
  Object.values(showGroups).forEach(showEntries => {
    if (showEntries.length < 2) return;
    // For each entry whose denominator is _unknown, look for a sibling with same type+variant
    const remaining = [...showEntries];
    showEntries.forEach(entry => {
      const p = entry.posters[0];
      if (denominatorKey(p) !== "_unknown") return;
      const typeVariant = `${(p.type || "").toLowerCase()}||${(p.variant || "").toLowerCase()}`;
      const candidates = remaining.filter(other =>
        other !== entry &&
        `${(other.posters[0].type || "").toLowerCase()}||${(other.posters[0].variant || "").toLowerCase()}` === typeVariant &&
        denominatorKey(other.posters[0]) !== "_unnumbered"
      );
      if (candidates.length === 1) {
        // Merge entry into candidates[0]
        candidates[0].posters.push(...entry.posters);
        delete byKey[entry.key];
        const idx = remaining.indexOf(entry);
        if (idx >= 0) remaining.splice(idx, 1);
      }
    });
  });

  const groupList = Object.values(byKey).map(list => ({
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
  // Unique illustrators (poster artists) — the people who designed the posters,
  // distinct from the bands the posters are for. Sorted alphabetically.
  const allIllustrators = [...new Set(
    STATE.posters.map(p => p.illustrator).filter(Boolean)
  )].sort();

  // Pre-compute the set of dates that fall on a festival the user attended.
  // A poster counts as "festival-related" if either:
  //   - tourShowSpecific === "Festival" (festival event poster), OR
  //   - the poster's date matches any concert with a festivalKey
  // Since the user can't attend a non-festival show on a festival day,
  // every poster on a festival date came from that festival.
  const festivalDates = new Set(
    STATE.concerts
      .filter(c => c.festivalKey && c.date)
      .map(c => c.date)
  );
  const isFestivalPoster = p =>
    (p.tourShowSpecific || "").toLowerCase() === "festival" ||
    (p.date && festivalDates.has(p.date));

  // ====================================================================
  // CASCADING FILTERS: when a band is selected, restrict the illustrator
  // and type dropdowns to values that exist within that band's posters.
  // Chips (Autographed, Festival, Not attended) are disabled (greyed out)
  // when no poster from the selected band qualifies. This prevents users
  // from picking filters that would always return zero.
  //
  // If no band is selected, all filter options remain available.
  // Currently-active chip filters stay active even if they no longer apply
  // (they're not auto-deselected) — the user can manually clear them.
  // ====================================================================
  const bandPosters = artist
    ? STATE.posters.filter(p => p.artist === artist && p.attended)
    : STATE.posters;
  const availableIllustrators = artist
    ? [...new Set(bandPosters.map(p => p.illustrator).filter(Boolean))].sort()
    : allIllustrators;
  const availableTypes = artist
    ? [...new Set(bandPosters.map(p => classifyType(p.type)).filter(Boolean))].sort()
    : allTypes;
  const bandHasAutographed = bandPosters.some(p => p.autographed);
  const bandHasFramed = bandPosters.some(p => p.framed);
  const bandHasFestival = bandPosters.some(p => isFestivalPoster(p));
  const bandHasNotAttended = artist
    ? STATE.posters.filter(p => p.artist === artist).some(p => !p.attended)
    : STATE.posters.some(p => !p.attended);

  const filterBar = el("div", { class: "filter-bar" });

  // Band filter (first) — was previously labeled "Artist", renamed to clarify
  // that it filters by the band/headliner, not the poster designer.
  const bandSelect = el("select", { on: { change: e => {
    // Clear illustrator and type when band changes — the previously selected
    // values may not be valid for the new band. (Active chips stay; user
    // can clear via reset link.)
    const [route, queryStr] = (location.hash || "#/posters").split("?");
    const p = new URLSearchParams(queryStr || "");
    if (e.target.value) p.set("artist", e.target.value); else p.delete("artist");
    p.delete("illustrator");
    p.delete("type");
    const newHash = route + (p.toString() ? "?" + p.toString() : "");
    location.hash = newHash;
  }}});
  bandSelect.appendChild(el("option", { value: "" }, "All bands"));
  allArtists.forEach(a => {
    const o = el("option", { value: a }, a);
    if (a === artist) o.selected = true;
    bandSelect.appendChild(o);
  });
  filterBar.appendChild(bandSelect);

  // Poster Artist (Illustrator) filter — restricted to band's illustrators when band is selected
  const illustratorSelect = el("select", {
    on: { change: e => updateParam("illustrator", e.target.value) }
  });
  illustratorSelect.appendChild(el("option", { value: "" }, "All poster artists"));
  availableIllustrators.forEach(name => {
    const o = el("option", { value: name }, name);
    if (name === illustrator) o.selected = true;
    illustratorSelect.appendChild(o);
  });
  filterBar.appendChild(illustratorSelect);

  const ts = el("select", { on: { change: e => updateParam("type", e.target.value) } });
  ts.appendChild(el("option", { value: "" }, "All types"));
  availableTypes.forEach(t => {
    const o = el("option", { value: t }, t);
    if (t === type) o.selected = true;
    ts.appendChild(o);
  });
  filterBar.appendChild(ts);

  // Helper for chip disabled state: if disabled but currently active, the
  // chip should still be visible (don't hide an active filter), but it
  // should still indicate the disabled-when-not-applicable state on hover.
  const makeChip = (label, active, isDisabled, paramName, options = {}) => {
    const cls = ["chip"];
    if (active) cls.push("active");
    if (isDisabled) cls.push("disabled");
    return el("button", {
      class: cls.join(" "),
      disabled: isDisabled && !active ? "" : null,
      title: options.title || (isDisabled
        ? `No ${label.toLowerCase()} posters for this band`
        : null),
      on: { click: () => {
        if (isDisabled && !active) return;
        updateParam(paramName, active ? "0" : "1");
      }}
    }, label);
  };

  filterBar.appendChild(makeChip("Autographed", autographed, !bandHasAutographed, "autographed"));
  filterBar.appendChild(makeChip("Framed", framedOnly, !bandHasFramed, "framed"));
  filterBar.appendChild(makeChip("Festival", festivalOnly, !bandHasFestival, "festival", {
    title: bandHasFestival
      ? "Show only posters from festival events (festival-wide posters and band posters from festival days)"
      : "No festival posters for this band"
  }));
  filterBar.appendChild(makeChip("Not attended", notAttended, !bandHasNotAttended, "notAttended"));

  // Reset link: visible whenever any filter is active. Clears all filter
  // params at once and returns the user to the unfiltered Posters view.
  const anyFilterActive = artist || illustrator || type || autographed ||
    framedOnly || festivalOnly || notAttended || q;
  if (anyFilterActive) {
    filterBar.appendChild(el("button", {
      class: "filter-reset-link",
      title: "Clear all filters",
      on: { click: () => { location.hash = "#/posters"; } }
    }, "Reset"));
  }

  const countEl = el("div", { class: "filter-count" });
  filterBar.appendChild(countEl);
  app.appendChild(filterBar);

  const qLower = q.toLowerCase();
  const filtered = groupList
    .map(g => {
      // When a filter applies to individual posters (type, autographed,
      // illustrator, festival), trim the group's posters to only matching
      // ones. The card preview and modal then show only what the filter asked for.
      let posters = g.posters;
      if (type) {
        posters = posters.filter(v => classifyType(v.type) === type);
      }
      if (autographed) {
        posters = posters.filter(v => v.autographed);
      }
      if (framedOnly) {
        posters = posters.filter(v => v.framed);
      }
      if (illustrator) {
        posters = posters.filter(v => v.illustrator === illustrator);
      }
      if (festivalOnly) {
        posters = posters.filter(v => isFestivalPoster(v));
      }
      return posters.length === g.posters.length ? g : { ...g, posters };
    })
    .filter(g => {
      // Drop groups that now have zero matching posters
      if (g.posters.length === 0) return false;
      if (artist && g.artist !== artist) return false;
      if (notAttended && g.attended) return false;
      if (qLower) {
        // Legacy: q param still works for shared/bookmarked URLs even though
        // the search box was removed from the UI. Searches across artist,
        // location, illustrator, notes, and variant fields.
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

  // Stash the filtered groups on STATE so click handlers can build nav context
  // for arrow-key navigation across posters in the current filter.
  STATE._posterNavList = filtered;

  // Attach Random + Screensaver action buttons to the page header (right side).
  // Built here (not earlier) so they can reference the `filtered` closure.
  headerActions.appendChild(el("button", {
    class: "header-action-btn",
    title: "Open a random poster from the current filter",
    on: { click: () => {
      if (filtered.length === 0) return;
      const idx = Math.floor(Math.random() * filtered.length);
      openPosterModal(filtered[idx], { list: filtered, index: idx });
    }}
  }, "🎲 Random"));

  headerActions.appendChild(el("button", {
    class: "header-action-btn screensaver-btn",
    title: "Full-screen rotating poster display — any key to exit",
    on: { click: () => startScreensaver() }
  }, "🖼 Screensaver"));

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
}

/**
 * Resolve a URL for a poster image of a specific kind.
 *
 * Three kinds are supported:
 *   - "stock":    the clean reference image of the poster (primary display)
 *   - "personal": user's own photo of the framed physical copy
 *   - "official": legacy, rarely used (kept for backward compat)
 *
 * Resolution order, highest priority first:
 *   1. Runtime override set via "Paste URL" in the modal (STATE.posterOverrides)
 *   2. URL in data/poster_images.csv (stock_url / personal_url / official_url)
 *   3. Local file at images/<kind>/poster-<id>.jpg
 *
 * Only a URL is returned; the <img> onerror handler should walk through
 * alternates if the first attempt fails (see displayChainForPoster()).
 */
function posterImageSrc(p, which = "stock") {
  const override = STATE.posterOverrides[p.id] || {};
  if (which === "stock" && override.stockImage) return override.stockImage;
  if (which === "personal" && override.personalImage) return override.personalImage;
  if (which === "official" && override.officialImage) return override.officialImage;
  const csv = STATE.posterImages[p.id] || {};
  if (which === "stock" && csv.stock_url) return csv.stock_url;
  if (which === "personal" && csv.personal_url) return csv.personal_url;
  if (which === "official" && csv.official_url) return csv.official_url;
  const base =
    which === "stock" ? "images/stock/" :
    which === "personal" ? "images/personal/" :
    "images/official/";
  return base + `poster-${p.id}.jpg`;
}

/**
 * Build the ordered list of src candidates to try for the "primary display"
 * image of a poster (gallery tile, marquee, etc.). Prefer stock, fall back to
 * personal. Each candidate is a full URL or local path; consumers use them
 * with an <img onerror> chain.
 *
 * For a poster with both stock + personal URLs, we attempt (in order):
 *   1. stock CSV/override URL (e.g. Drive thumbnail)
 *   2. images/stock/poster-<id>.jpg  (downloaded local copy)
 *   3. personal CSV/override URL
 *   4. images/personal/poster-<id>.jpg  (downloaded local copy)
 * Duplicates are removed.
 */
function displayChainForPoster(p) {
  const tries = [
    posterImageSrc(p, "stock"),
    `images/stock/poster-${p.id}.jpg`,
    posterImageSrc(p, "personal"),
    `images/personal/poster-${p.id}.jpg`,
  ];
  // Drop empty strings and dedupe while preserving order
  const seen = new Set();
  return tries.filter(v => {
    if (!v || seen.has(v)) return false;
    seen.add(v);
    return true;
  });
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
    const tries = displayChainForPoster(primary);

    const tile = el("div", {
      class: "marquee-tile",
      title: `${g.artist} · ${formatDate(g.date)}`,
      on: { click: () => openPosterModalWithNav(g) }
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

  // The marquee normally duplicates its content so it can scroll seamlessly:
  // animation slides -50% (full width of one copy), then the second copy
  // becomes visible without a jump. But when the filter has few items, this
  // duplication makes the same poster appear twice within one viewport,
  // which reads as a bug. Below a threshold we skip duplication and the
  // marquee scrolls a single set; the loop is less seamless but the absence
  // of visible duplicates is more important than perfect smoothness.
  const DUP_THRESHOLD = 5;
  shuffled.forEach(g => track.appendChild(buildTile(g)));
  if (shuffled.length >= DUP_THRESHOLD) {
    shuffled.forEach(g => track.appendChild(buildTile(g)));
    track.classList.add("marquee-track-duplicated");
  }

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

  const tries = displayChainForPoster(primary);

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
    on: { click: () => openPosterModalWithNav(g) }
  }, thumb, info);
  return card;
}

/* ============================================================
   SONGS VIEW
   Two modes:
     #/songs                — global song explorer
     #/songs?artist=Tool    — drill-down to one artist
   Optional params:
     q=<text>               — search within song/artist names
     song=<name>            — filter to a specific song (shows all plays of it)
     count=<N>              — show only songs heard exactly N times
     covers=1               — only covers (song.cover is set)
   ============================================================ */
function renderSongs() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const params = new URLSearchParams((location.hash.split("?")[1] || ""));
  const q = (params.get("q") || "").toLowerCase();
  const artistFilter = params.get("artist") || "";
  const songFilter = params.get("song") || "";
  const countFilter = params.get("count") || "";
  const coversOnly = params.get("covers") === "1";

  // Aggregate performances once
  // songKey = "normArtist||songLower" — collapses "Mars Volta" vs "The Mars Volta"
  // into one entry and treats case-insensitively.
  const perfByKey = {};  // songKey -> { artist, song, plays: [{date, concert, cover}], cover }
  const artistSet = new Map();  // normArtist -> display name (most common spelling)

  let totalPerfs = 0;
  for (const perf of iterAllSongPerformances()) {
    totalPerfs++;
    const normArt = normalizeArtistKey(perf.artist);
    if (!normArt) continue;
    if (!artistSet.has(normArt)) artistSet.set(normArt, perf.artist);

    const key = `${normArt}||${perf.song.toLowerCase()}`;
    if (!perfByKey[key]) {
      perfByKey[key] = {
        normArtist: normArt,
        artist: perf.artist,
        song: perf.song,
        plays: [],
        cover: perf.cover || null,
      };
    }
    perfByKey[key].plays.push({
      date: perf.date,
      concert: perf.concert,
      role: perf.role,
    });
    // If we see a "cover of X" annotation on at least one performance, keep it
    if (perf.cover) perfByKey[key].cover = perf.cover;
  }

  const allSongs = Object.values(perfByKey);
  const totalUniqueSongs = allSongs.length;

  if (totalPerfs === 0) {
    app.appendChild(el("div", { class: "view-header" },
      el("h2", { class: "view-title" }, "Songs ", el("span", { class: "accent" }, "heard live")),
      el("p", { class: "view-sub" }, "No setlist data yet — run prefetch_setlists.py to populate.")
    ));
    return;
  }

  // Resolve artist-filter (if set) to its normalized form + display name
  let filterNormArtist = null;
  let filterArtistDisplay = null;
  if (artistFilter) {
    filterNormArtist = normalizeArtistKey(artistFilter);
    filterArtistDisplay = artistSet.get(filterNormArtist) || artistFilter;
  }

  // Header
  if (filterNormArtist) {
    // Drill-down view for one artist
    app.appendChild(el("div", { class: "view-header" },
      el("div", { class: "songs-breadcrumb" },
        el("a", { href: "#/songs", class: "crumb-link" }, "← All songs"),
      ),
      el("h2", { class: "view-title" },
        el("span", { class: "accent" }, filterArtistDisplay),
        " ", el("span", {}, "on stage")
      ),
      el("p", { class: "view-sub" }, `Every song you've heard ${filterArtistDisplay} play live.`)
    ));
  } else {
    app.appendChild(el("div", { class: "view-header" },
      el("h2", { class: "view-title" }, "Songs ", el("span", { class: "accent" }, "heard live")),
      el("p", { class: "view-sub" },
        `${totalPerfs.toLocaleString()} total performances · ${totalUniqueSongs.toLocaleString()} unique songs.`
      )
    ));
  }

  // Coverage caveat — only show on the global view, not inside an artist drill-down
  if (!filterNormArtist) {
    app.appendChild(el("div", { class: "coverage-note" },
      el("p", {},
        el("strong", {}, "About this data: "),
        "Pulled from setlist.fm. Coverage is strong for headliners and top festival acts, ",
        "partial for named openers, and thin for smaller festival-lineup bands. Counts reflect ",
        "what's in setlist.fm — the true numbers of times you heard something live may be higher."
      )
    ));
  }

  // Filter bar.
  // Order (matching Posters page convention): Band → Song Title → Heard count → Covers.
  // Search box was removed for consistency with the other pages — the
  // dropdowns cover the common filtering needs.
  const filterBar = el("div", { class: "filter-bar" });

  // Band selector (first). On the global view, switching the band navigates
  // to the artist drill-down. On the drill-down view, the band is fixed and
  // we don't show this selector — it'd be redundant.
  if (!filterNormArtist) {
    const artistList = [...artistSet.entries()]
      .map(([k, v]) => ({ key: k, display: v }))
      .sort((a, b) => a.display.localeCompare(b.display));
    const bandSelect = el("select", {
      on: { change: e => {
        const v = e.target.value;
        if (v) location.hash = "#/songs?artist=" + encodeURIComponent(v);
      }}
    });
    bandSelect.appendChild(el("option", { value: "" }, "All bands"));
    artistList.forEach(a => bandSelect.appendChild(el("option", { value: a.display }, a.display)));
    filterBar.appendChild(bandSelect);
  }

  // Song Title selector — only on global view (no point on drill-down where
  // the song list is right there in the page).
  if (!filterNormArtist) {
    // Build unique song titles, sorted alphabetically. Each title shown once
    // even if multiple bands have a song with the same name (selecting it
    // filters across all of them).
    const allSongTitles = [...new Set(allSongs.map(s => s.song))].sort();
    const songSelect = el("select", {
      on: { change: e => updateParam("song", e.target.value) }
    });
    songSelect.appendChild(el("option", { value: "" }, "All song titles"));
    allSongTitles.forEach(title => {
      const o = el("option", { value: title }, title);
      if (title === songFilter) o.selected = true;
      songSelect.appendChild(o);
    });
    filterBar.appendChild(songSelect);
  }

  // Heard-N-times dropdown (distinct play-counts present in data)
  const playCounts = [...new Set(allSongs.map(s => s.plays.length))].sort((a, b) => a - b);
  const countSelect = el("select", {
    on: { change: e => updateParam("count", e.target.value) }
  });
  countSelect.appendChild(el("option", { value: "" }, "Any play-count"));
  playCounts.forEach(n => {
    const o = el("option", { value: String(n) }, `Heard exactly ${n}×`);
    if (String(n) === countFilter) o.selected = true;
    countSelect.appendChild(o);
  });
  filterBar.appendChild(countSelect);

  // Covers-only toggle
  filterBar.appendChild(el("button", {
    class: "chip" + (coversOnly ? " active" : ""),
    on: { click: () => updateParam("covers", coversOnly ? "0" : "1") }
  }, "Covers only"));

  // Reset link: visible whenever any Songs filter is active.
  const anySongsFilter = q || artistFilter || songFilter || countFilter || coversOnly;
  if (anySongsFilter) {
    filterBar.appendChild(el("button", {
      class: "filter-reset-link",
      title: "Clear all filters",
      on: { click: () => { location.hash = "#/songs"; } }
    }, "Reset"));
  }

  const countEl = el("span", { class: "filter-count" });
  filterBar.appendChild(countEl);
  app.appendChild(filterBar);

  // Apply filters
  let filtered = allSongs;
  if (filterNormArtist) {
    filtered = filtered.filter(s => s.normArtist === filterNormArtist);
  }
  if (songFilter) {
    const sf = songFilter.toLowerCase();
    filtered = filtered.filter(s => s.song.toLowerCase() === sf);
  }
  if (q) {
    filtered = filtered.filter(s =>
      s.song.toLowerCase().includes(q) ||
      s.artist.toLowerCase().includes(q)
    );
  }
  if (countFilter) {
    const n = parseInt(countFilter, 10);
    filtered = filtered.filter(s => s.plays.length === n);
  }
  if (coversOnly) {
    filtered = filtered.filter(s => s.cover);
  }

  // Sort: most-played first, then alphabetical by song
  filtered.sort((a, b) => b.plays.length - a.plays.length || a.song.localeCompare(b.song));

  countEl.textContent = `${filtered.length} song${filtered.length === 1 ? "" : "s"}`;

  if (filtered.length === 0) {
    app.appendChild(el("div", { class: "loading" }, "No songs match these filters."));
    return;
  }

  // Render the table
  const table = el("div", { class: "songs-table" });

  // Header row
  const showArtistCol = !filterNormArtist;
  const header = el("div", { class: "songs-row songs-header" });
  header.appendChild(el("span", { class: "col-rank" }, "#"));
  header.appendChild(el("span", { class: "col-song" }, "Song"));
  if (showArtistCol) {
    header.appendChild(el("span", { class: "col-artist" }, "Band"));
  }
  header.appendChild(el("span", { class: "col-first" }, "First heard"));
  header.appendChild(el("span", { class: "col-last" }, "Last heard"));
  header.appendChild(el("span", { class: "col-count" }, "Plays"));
  table.appendChild(header);

  filtered.slice(0, 300).forEach((s, i) => {  // cap render at 300 for perf on huge data
    // Derive first/last from play dates
    const datedPlays = s.plays.filter(p => p.date).sort((a, b) => a.date.localeCompare(b.date));
    const first = datedPlays[0];
    const last = datedPlays[datedPlays.length - 1];

    const row = el("div", { class: "songs-row" });
    row.appendChild(el("span", { class: "col-rank" }, String(i + 1).padStart(3, "0")));

    // Song cell: name + optional cover annotation
    const songCell = el("span", { class: "col-song" },
      el("strong", {}, s.song)
    );
    if (s.cover) {
      songCell.appendChild(el("span", { class: "song-cover-note" }, ` · cover of ${s.cover}`));
    }
    row.appendChild(songCell);

    if (showArtistCol) {
      // Artist cell — clickable to drill down to that artist
      const artistCell = el("span", { class: "col-artist" },
        el("a", {
          href: "#/songs?artist=" + encodeURIComponent(s.artist),
          class: "artist-link"
        }, s.artist)
      );
      row.appendChild(artistCell);
    }

    row.appendChild(el("span", { class: "col-first" }, first ? formatDateShort(first.date) : "—"));
    row.appendChild(el("span", { class: "col-last" }, last ? formatDateShort(last.date) : "—"));

    // Play count — clickable to reveal a show list inline
    const countCell = el("span", { class: "col-count" },
      el("button", {
        class: "play-count-btn",
        title: "Click to see which shows",
        on: { click: () => togglePlayDetails(row, s) }
      }, `${s.plays.length}×`)
    );
    row.appendChild(countCell);

    table.appendChild(row);
  });
  app.appendChild(table);

  if (filtered.length > 300) {
    app.appendChild(el("div", { class: "loading", style: "margin-top:16px;" },
      `Showing first 300 of ${filtered.length}. Narrow the filter to see more.`
    ));
  }

  // Missing coverage — only shown on the artist drill-down view.
  // Walks every concert where this artist appeared (as headliner or opener)
  // and reports which ones don't have setlist data in our cache.
  if (filterNormArtist) {
    const coverage = computeArtistCoverage(filterArtistDisplay, filterNormArtist);
    if (coverage.withoutData.length > 0 || coverage.withData.length > 0) {
      app.appendChild(renderCoverageBlock(filterArtistDisplay, coverage));
    }
  }
}

/**
 * For a given artist, walk STATE.concerts and classify each appearance by
 * whether we have setlist data for it. Appearances can be:
 *   - headliner: concert.artist matches
 *   - opener:    artist is in concert.openingActs
 *
 * Returns { withData: [...], withoutData: [{concert, role, reason}] } where
 * `reason` explains why no data (no URL, search miss, fetch error, etc.).
 */
function computeArtistCoverage(displayName, normArtistKey) {
  const withData = [];
  const withoutData = [];

  for (const c of STATE.concerts) {
    // Figure out this artist's role at this show, if any
    const headlinerMatch = normalizeArtistKey(c.artist) === normArtistKey && !c.festivalKey;

    let openerMatch = false;
    for (const opener of splitActs(c.openingActs)) {
      if (normalizeArtistKey(opener) === normArtistKey) {
        openerMatch = true;
        break;
      }
    }

    if (!headlinerMatch && !openerMatch) continue;

    const role = headlinerMatch ? "headliner" : "opener";

    // Check cache for data
    let cacheKey = null;
    let cached = null;
    if (role === "headliner") {
      cacheKey = extractSetlistId(c.setlistLink);
      if (cacheKey) cached = STATE.setlists[cacheKey];
    } else {
      // Opener key uses the exact spelling from openingActs, not the display name.
      // Find the original spelling by walking the acts for this concert.
      for (const opener of splitActs(c.openingActs)) {
        if (normalizeArtistKey(opener) === normArtistKey) {
          cacheKey = openerCacheKey(opener, c.date);
          cached = STATE.setlists[cacheKey];
          break;
        }
      }
    }

    // Has usable data?
    if (cached && !cached._error && cached.sets && cached.sets.length) {
      withData.push({ concert: c, role });
    } else {
      // Classify the reason
      let reason;
      if (role === "headliner" && !c.setlistLink) {
        reason = "No setlist URL in your spreadsheet";
      } else if (!cached) {
        reason = role === "headliner"
          ? "Not yet fetched (run prefetch_setlists.py)"
          : "Not yet searched (run prefetch_setlists.py)";
      } else if (cached._error === "no match") {
        reason = "No match on setlist.fm";
      } else if (cached._error === "no artist match") {
        reason = "setlist.fm returned different artists";
      } else if (cached._error === "empty setlist") {
        reason = "setlist.fm has the show but no songs listed";
      } else if (cached._error) {
        reason = `Fetch error: ${cached._error}`;
      } else {
        reason = "No songs in cached data";
      }
      withoutData.push({ concert: c, role, reason });
    }
  }

  // Sort by date, newest first (matches timeline order)
  const byDateDesc = (a, b) => (b.concert.date || "").localeCompare(a.concert.date || "");
  withData.sort(byDateDesc);
  withoutData.sort(byDateDesc);

  return { withData, withoutData };
}

/**
 * Render the "Coverage" block shown at the bottom of an artist drill-down.
 * Shows a summary ("6 of 8 shows covered") and lists any shows without data,
 * with an explanation for each.
 */
function renderCoverageBlock(displayName, coverage) {
  const total = coverage.withData.length + coverage.withoutData.length;
  const pct = total > 0 ? Math.round((coverage.withData.length / total) * 100) : 0;

  const block = el("div", { class: "coverage-block" });
  block.appendChild(el("h3", { class: "coverage-title" }, "Setlist coverage"));

  block.appendChild(el("p", { class: "coverage-summary" },
    `You've seen ${displayName} `,
    el("strong", {}, `${total} time${total === 1 ? "" : "s"}`),
    `. Setlist data available for `,
    el("strong", {}, `${coverage.withData.length}`),
    ` of them (${pct}%).`
  ));

  if (coverage.withoutData.length === 0) {
    block.appendChild(el("p", { class: "coverage-summary", style: "color: var(--accent-2);" },
      "✓ Full coverage — every show you saw them is represented in the song data above."
    ));
    return block;
  }

  block.appendChild(el("p", { class: "coverage-summary" },
    "Shows without setlist data (their songs are ",
    el("em", {}, "not"),
    " in the counts above):"
  ));

  const list = el("div", { class: "coverage-list" });
  coverage.withoutData.forEach(entry => {
    const c = entry.concert;
    const line = el("div", {
      class: "coverage-item",
      title: "Click to view show details",
      on: { click: () => openConcertModal(c) }
    });
    line.appendChild(el("span", { class: "cov-date" }, formatDate(c.date)));
    line.appendChild(el("span", { class: "cov-venue" },
      `${c.venue || "?"}${c.city ? " · " + c.city : ""}`
    ));
    line.appendChild(el("span", { class: "cov-role" },
      entry.role === "opener" ? "opener" : "headliner"
    ));
    line.appendChild(el("span", { class: "cov-reason" }, entry.reason));
    list.appendChild(line);
  });
  block.appendChild(list);

  return block;
}

/**
 * Expand a song row to show the list of shows where it was played.
 * Clicking the "N×" button toggles an inline detail row beneath.
 */
function togglePlayDetails(rowEl, songEntry) {
  const existing = rowEl.nextElementSibling;
  if (existing && existing.classList.contains("songs-detail")) {
    existing.remove();
    return;
  }
  const detail = el("div", { class: "songs-detail" });
  const plays = [...songEntry.plays].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  plays.forEach(p => {
    // Build the label once so we can use it in both the clickable and
    // non-clickable variants below.
    const label = formatDate(p.date);
    const metaText = p.concert
      ? ` · ${p.concert.venue || "?"}${p.concert.city ? " · " + p.concert.city : ""}${p.role === "opener" ? " · opening slot" : ""}`
      : (p.role === "opener" ? " · opening slot" : "");

    if (p.concert) {
      // Whole line is clickable; clicking opens the concert modal directly.
      // Using a button-styled div rather than an <a href> so we can trigger
      // the modal via JS without navigating away from the Songs page.
      const line = el("div", {
        class: "song-play song-play-clickable",
        title: "View show details",
        on: { click: () => openConcertModal(p.concert) }
      });
      line.appendChild(el("span", { class: "song-play-date" }, label));
      line.appendChild(el("span", { class: "song-play-meta" }, metaText));
      detail.appendChild(line);
    } else {
      // Data refers to a show we don't have a matching concert record for
      // (shouldn't normally happen, but safe fallback).
      const line = el("div", { class: "song-play" });
      line.appendChild(el("span", { class: "song-play-date" }, label));
      if (metaText) line.appendChild(el("span", { class: "song-play-meta" }, metaText));
      detail.appendChild(line);
    }
  });
  rowEl.insertAdjacentElement("afterend", detail);
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
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

  // Read heatmap scale preference from URL. Defaults to per-year (each row
  // scales independently); users can flip to "all" to compare years against
  // the single busiest month across all years.
  const statsParams = new URLSearchParams((location.hash.split("?")[1] || ""));

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

  // Unique headliners — distinct top-billed artists (excluding festivals,
  // since "Festival" isn't a band). Smaller number than Unique bands; included
  // as a sub-metric on the Unique Bands KPI.
  const uniqueHeadliners = new Set();
  past.forEach(c => {
    headlinerAtConcert(c).forEach(name => {
      const key = normalizeArtistKey(name);
      if (key) uniqueHeadliners.add(key);
    });
  });

  const uniqueVenues = new Set(past.map(c => c.venue).filter(Boolean));
  const uniqueStates = new Set(past.map(c => c.state).filter(Boolean));
  const uniqueFestivals = new Set(past.map(c => c.festivalKey).filter(Boolean));

  // Unique cities: use city+state as the key since "Portland OR" and "Portland ME"
  // shouldn't collapse into one entry. Display label is "City, ST" for consistency.
  const cityKey = c => c.city ? `${c.city}||${c.state || ""}` : null;
  const cityLabel = c => c.state ? `${c.city}, ${c.state}` : c.city;
  const uniqueCities = new Set();
  past.forEach(c => { const k = cityKey(c); if (k) uniqueCities.add(k); });

  const firstYear = Math.min(...past.map(c => c.year));
  const lastYear = Math.max(...past.map(c => c.year));

  // Sub-metric values for cards that have them
  const showsSolo = past.filter(c => !c.attendedWith || splitAttendedWith(c.attendedWith).length === 0).length;
  const showsWithFriends = past.length - showsSolo;
  const totalFestivalDays = past.filter(c => c.festivalKey).length;
  const postersAttended = STATE.posters.filter(p => p.attended).length;
  const postersNotAttended = STATE.posters.length - postersAttended;
  const autographedCount = STATE.posters.filter(p => p.autographed).length;
  const framedCount = STATE.posters.filter(p => p.framed).length;

  // KPI cards. Each card may have sub-metrics (small lines below the unit)
  // and an onClick handler that navigates to the relevant view.
  const grid = el("div", { class: "stats-grid" });
  const kpis = [
    {
      label: "Shows attended",
      value: past.length,
      unit: "days logged",
      submetrics: showsWithFriends > 0
        ? [`${showsWithFriends} with friends · ${showsSolo} solo`]
        : null,
      onClick: () => { location.hash = "#/timeline"; }
    },
    {
      label: "Festivals",
      value: uniqueFestivals.size,
      unit: "multi-day events",
      submetrics: totalFestivalDays > 0
        ? [`${totalFestivalDays} festival days total`]
        : null,
      onClick: () => openFestivalsListModal()
    },
    {
      label: "Unique bands",
      value: uniqueArtists.size,
      unit: "headliners + openers",
      submetrics: [`${uniqueHeadliners.size} unique headliners`],
      onClick: () => openBandsHeatmapModal(artistCountByKey, canonicalDisplay, artistRole)
    },
    {
      label: "Unique venues",
      value: uniqueVenues.size,
      submetrics: [
        `${uniqueCities.size} unique cities · across ${uniqueStates.size} states`
      ],
      onClick: () => {
        // Stay on Stats page, set picker to Venues, scroll to that card.
        // The sub-line lists cities and states for context; if the user wants
        // to see those leaderboards, they can switch the picker themselves.
        const [route, queryStr] = (location.hash || "#/stats").split("?");
        const p = new URLSearchParams(queryStr || "");
        p.delete("placesView");  // Venues is the default
        const newHash = route + (p.toString() ? "?" + p.toString() : "");
        location.hash = newHash;
        scrollToPlaces();
      }
    },
    {
      label: "Posters",
      value: STATE.posters.length,
      unit: "collected",
      submetrics: (() => {
        const lines = [];
        if (postersNotAttended > 0) {
          lines.push(`${postersAttended} attended posters · ${postersNotAttended} unattended posters`);
        }
        if (framedCount > 0) {
          lines.push(`${framedCount} framed`);
        }
        return lines.length > 0 ? lines : null;
      })(),
      onClick: () => { location.hash = "#/posters"; }
    },
    {
      label: "Autographed",
      value: autographedCount,
      unit: "posters",
      onClick: () => { location.hash = "#/posters?autographed=1"; }
    },
    {
      label: "Years of live music",
      value: (lastYear - firstYear + 1),
      unit: `${firstYear} – ${lastYear}`,
      onClick: () => {
        // Already on stats — scroll to the year chart
        setTimeout(() => {
          const yc = document.querySelector(".year-chart");
          if (yc) yc.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
      }
    },
  ];
  kpis.forEach(s => {
    const cardChildren = [
      el("p", { class: "stat-label" }, s.label),
      el("p", { class: "stat-value" }, String(s.value)),
    ];
    if (s.unit) cardChildren.push(el("p", { class: "stat-unit" }, s.unit));
    if (s.submetrics && s.submetrics.length) {
      s.submetrics.forEach(sm => {
        cardChildren.push(el("p", { class: "stat-submetric" }, sm));
      });
    }
    const card = el("div", {
      class: "stat-card" + (s.onClick ? " stat-card-clickable" : ""),
      title: s.onClick ? "Click for more" : null,
      on: s.onClick ? { click: s.onClick } : {}
    }, ...cardChildren);
    grid.appendChild(card);
  });
  app.appendChild(grid);

  // Helper: scroll to the Most-visited card. Used by Unique venues / cities clicks.
  function scrollToPlaces() {
    setTimeout(() => {
      // Find the leaderboard with "Most-visited" header
      const cards = document.querySelectorAll(".top-list");
      for (const c of cards) {
        if (c.querySelector("h3")?.textContent?.trim() === "Most-visited") {
          c.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
      }
    }, 80);
  }

  // Role filter for the Most-seen artists leaderboard. Reads from URL so
  // it persists across stat-page reloads. Values: "all" (default), "headliner", "opener".
  const artistRole = (() => {
    const v = (statsParams.get("artistRole") || "").toLowerCase();
    return (v === "headliner" || v === "opener") ? v : "all";
  })();

  // Top artists: count every band per the selected role.
  // We normalize keys so "Mars Volta" and "The Mars Volta" count as one entry,
  // but display the most common version as the label.
  const artistCountByKey = {};   // norm-key -> count
  const artistDisplayByKey = {}; // norm-key -> {display-name: count-of-uses}
  past.forEach(c => {
    artistsAtConcertByRole(c, artistRole).forEach(name => {
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

  // Build the role-toggle dropdown (matches the heatmap toggle style)
  const roleSelect = el("select", {
    class: "leaderboard-role-toggle",
    title: "Show all artists, only headliners, or only openers",
    on: { change: e => {
      const next = e.target.value;
      const [route, queryStr] = (location.hash || "#/stats").split("?");
      const params = new URLSearchParams(queryStr || "");
      if (next === "all") {
        params.delete("artistRole");
      } else {
        params.set("artistRole", next);
      }
      const newHash = route + (params.toString() ? "?" + params.toString() : "");
      history.replaceState(null, "", newHash);
      renderStats();
    }}
  });
  [
    ["all", "All"],
    ["headliner", "Headliners"],
    ["opener", "Openers"]
  ].forEach(([val, label]) => {
    const o = el("option", { value: val }, label);
    if (val === artistRole) o.selected = true;
    roleSelect.appendChild(o);
  });

  const artistList = el("div", { class: "top-list" },
    el("div", { class: "leaderboard-header" },
      // Title is clickable — opens the bands heatmap modal. Wrap it as a
      // button so it's keyboard-focusable and reads as interactive. The
      // picker dropdown is a sibling so click events on it don't bubble
      // up to the title.
      el("h3", { class: "leaderboard-title-clickable" },
        el("button", {
          class: "leaderboard-title-btn",
          title: "Open the bands heatmap",
          on: { click: () => openBandsHeatmapModal(artistCountByKey, canonicalDisplay, artistRole) }
        },
          "Most-seen bands ",
          el("span", { class: "leaderboard-title-icon" }, "▦")
        )
      ),
      roleSelect
    ),
    el("ol", {}, ...topArtists.map(([name, count], i) =>
      el("li", {
        on: { click: () => openArtistInsightsModal(name) },
        style: "cursor:pointer;",
        title: `Click to see when you saw ${name}`
      },
        el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
        el("span", { class: "name" }, name),
        el("span", { class: "count" }, `${count}×`)
      )
    ))
  );
  twoCol.appendChild(artistList);

  // ====================================================================
  // MOST-VISITED PLACES — consolidated leaderboard with a picker that
  // toggles between venues / cities / states. The previously separate
  // "Most-visited cities" card is rolled into this one.
  // URL param: ?placesView=venues|cities|states (defaults to venues)
  // ====================================================================
  const placesView = (() => {
    const v = (statsParams.get("placesView") || "").toLowerCase();
    return (v === "cities" || v === "states") ? v : "venues";
  })();

  // Build all three datasets up front so the picker switch is just a re-render
  // away. The cost is trivial (~100 concerts) and avoids tangled conditionals.

  // Venues: keyed by "venue || city" so two venues with the same name in
  // different cities don't collide. Display label keeps the original "venue — city" format.
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
  // Full venue list (no top-12 cap) for the heatmap modal — keep "2+ visits"
  // filter so we don't drown the heatmap in single-show venues.
  const allVenues = Object.entries(venueCount)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);

  // Cities: from the cityKey/cityLabel helpers defined above for KPI counts.
  const placeCityCount = {};
  const placeCityDisplay = {};
  past.forEach(c => {
    const k = cityKey(c);
    if (!k) return;
    placeCityCount[k] = (placeCityCount[k] || 0) + 1;
    placeCityDisplay[k] = cityLabel(c);
  });
  const topCities = Object.entries(placeCityCount)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const allCities = Object.entries(placeCityCount)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1]);

  // States: simple state-code rollup. Friendly label uses STATE.stateNames
  // so "NC" displays as "North Carolina".
  const stateCount = {};
  past.forEach(c => {
    if (c.state) stateCount[c.state] = (stateCount[c.state] || 0) + 1;
  });
  const topStates = Object.entries(stateCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  // Pick the dataset for the current view. Each entry is normalized to
  // [displayLabel, count, clickHandler] so the rendering loop is uniform.
  const placesData = (() => {
    if (placesView === "cities") {
      return topCities.map(([key, count]) => {
        const label = placeCityDisplay[key] || key;
        return [label, count, () => {
          // Filter timeline by the city — use the city name as search query
          const cityName = label.split(",")[0].trim();
          location.hash = "#/timeline?q=" + encodeURIComponent(cityName);
        }];
      });
    }
    if (placesView === "states") {
      return topStates.map(([code, count]) => {
        const label = (STATE.stateNames && STATE.stateNames[code]) || code;
        return [label, count, () => {
          location.hash = "#/timeline?state=" + encodeURIComponent(code);
        }];
      });
    }
    // venues (default)
    return topVenues.map(([name, count]) => {
      return [name, count, () => {
        location.hash = "#/timeline?venue=" + encodeURIComponent(name.split(" — ")[0]);
      }];
    });
  })();

  // Picker dropdown — same visual treatment as the role toggle on Most-seen bands.
  const placesPicker = el("select", {
    class: "leaderboard-role-toggle",
    title: "Switch between venues, cities, and states",
    on: { change: e => {
      const next = e.target.value;
      const [route, queryStr] = (location.hash || "#/stats").split("?");
      const p = new URLSearchParams(queryStr || "");
      if (next === "venues") p.delete("placesView");
      else p.set("placesView", next);
      const newHash = route + (p.toString() ? "?" + p.toString() : "");
      history.replaceState(null, "", newHash);
      renderStats();
    }}
  });
  [
    ["venues", "Venues"],
    ["cities", "Cities"],
    ["states", "States"]
  ].forEach(([val, label]) => {
    const o = el("option", { value: val }, label);
    if (val === placesView) o.selected = true;
    placesPicker.appendChild(o);
  });

  // Build the FULL list for the heatmap modal (not capped at 12).
  // Each entry is [label, count, onClick] — same shape as placesData.
  const placesDataFull = (() => {
    if (placesView === "cities") {
      return allCities.map(([key, count]) => {
        const label = placeCityDisplay[key] || key;
        return [label, count, () => {
          const cityName = label.split(",")[0].trim();
          location.hash = "#/timeline?q=" + encodeURIComponent(cityName);
        }];
      });
    }
    // venues (states doesn't support heatmap)
    return allVenues.map(([name, count]) => {
      return [name, count, () => {
        location.hash = "#/timeline?venue=" + encodeURIComponent(name.split(" — ")[0]);
      }];
    });
  })();

  // Title is clickable when in Venues or Cities view — opens a heatmap modal
  // showing all entries sized by visit count. States view skips the modal
  // because with only ~13 states (and one big outlier), a heatmap is overkill;
  // the simple list is enough on its own.
  const supportsHeatmap = placesView === "venues" || placesView === "cities";
  const placesHeader = supportsHeatmap
    ? el("h3", { class: "leaderboard-title-clickable" },
        el("button", {
          class: "leaderboard-title-btn",
          title: `Open the ${placesView} heatmap`,
          on: { click: () => openPlacesHeatmapModal(placesView, placesDataFull) }
        },
          "Most-visited ",
          el("span", { class: "leaderboard-title-icon" }, "▦")
        )
      )
    : el("h3", {}, "Most-visited");

  const venueList = el("div", { class: "top-list" },
    el("div", { class: "leaderboard-header" },
      placesHeader,
      placesPicker
    ),
    el("ol", {}, ...placesData.map(([label, count, onClick], i) =>
      el("li", {
        on: { click: onClick },
        style: "cursor:pointer;"
      },
        el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
        el("span", { class: "name" }, label),
        el("span", { class: "count" }, `${count}×`)
      )
    ))
  );
  twoCol.appendChild(venueList);
  app.appendChild(twoCol);

  // ------------------------------------------------------------------
  // Setlist-based stats: top songs (overall) and by artist
  // Aggregates across every cached setlist (headliners + openers).
  // ------------------------------------------------------------------
  const songsByArtist = {};       // normArtist -> { songName -> count }
  const songTotalCount = {};      // "artist — song" -> count (global across artists)
  const songDisplayArtist = {};   // normArtist -> display name (most common spelling)
  const artistTotalSongs = {};    // normArtist -> total song performances (for "most musical")

  const performances = [];
  for (const perf of iterAllSongPerformances()) {
    performances.push(perf);
    const normArt = normalizeArtistKey(perf.artist);
    if (!normArt) continue;
    // Track display name
    songDisplayArtist[normArt] = songDisplayArtist[normArt] || perf.artist;

    // Per-artist song tally
    songsByArtist[normArt] = songsByArtist[normArt] || {};
    songsByArtist[normArt][perf.song] = (songsByArtist[normArt][perf.song] || 0) + 1;

    // Global "artist — song" tally for overall top songs
    const globalKey = `${normArt}||${perf.song.toLowerCase()}`;
    songTotalCount[globalKey] = songTotalCount[globalKey] || { artist: perf.artist, song: perf.song, count: 0 };
    songTotalCount[globalKey].count++;

    artistTotalSongs[normArt] = (artistTotalSongs[normArt] || 0) + 1;
  }

  const totalUniqueSongs = Object.keys(songTotalCount).length;
  const totalPerformances = performances.length;

  // Songs section: rendered below Show buddies (per user preference).
  // We compute the data here but defer DOM append until after the buddies block.
  // Click a song row → opens Song Insights modal showing every time you heard it.
  const renderSongsSection = () => {
    if (totalPerformances === 0) return;

    const songStatsIntro = el("div", { class: "song-stats-intro" },
      el("h3", { style: "margin-bottom:8px;" }, "Songs heard live"),
      el("p", { class: "song-stats-note" },
        `Aggregated from ${totalPerformances.toLocaleString()} song performances across every setlist we have for your shows. `,
        `${totalUniqueSongs.toLocaleString()} unique songs. `,
        el("em", {}, "Based on setlists pulled from setlist.fm — coverage is best for headliners and top festival acts, partial for smaller openers.")
      )
    );
    songStatsIntro.style.marginTop = "32px";
    app.appendChild(songStatsIntro);

    const topSongs = Object.values(songTotalCount)
      .filter(s => s.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const artistSongLeaders = Object.entries(songsByArtist)
      .filter(([normArt, songs]) => artistTotalSongs[normArt] >= 5)
      .map(([normArt, songs]) => {
        const [topSong, topCount] = Object.entries(songs)
          .sort((a, b) => b[1] - a[1])[0] || [];
        return {
          artist: songDisplayArtist[normArt],
          song: topSong,
          count: topCount,
          artistTotal: artistTotalSongs[normArt],
        };
      })
      .filter(e => e.song && e.count > 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const songsView = (() => {
      const v = (statsParams.get("songsView") || "").toLowerCase();
      return v === "topPerBand".toLowerCase() ? "topPerBand" : "heard";
    })();

    if (topSongs.length === 0 && artistSongLeaders.length === 0) return;

    const songsPicker = el("select", {
      class: "leaderboard-role-toggle",
      title: "Switch between most-heard songs and top song per band",
      on: { change: e => {
        const next = e.target.value;
        const [route, queryStr] = (location.hash || "#/stats").split("?");
        const p = new URLSearchParams(queryStr || "");
        if (next === "heard") p.delete("songsView");
        else p.set("songsView", next);
        const newHash = route + (p.toString() ? "?" + p.toString() : "");
        history.replaceState(null, "", newHash);
        renderStats();
      }}
    });
    [
      ["heard", "Most-heard songs"],
      ["topPerBand", "Top song per band"]
    ].forEach(([val, label]) => {
      const o = el("option", { value: val }, label);
      if (val === songsView) o.selected = true;
      songsPicker.appendChild(o);
    });

    const songsCard = el("div", { class: "top-list" },
      el("div", { class: "leaderboard-header" },
        el("h3", {}, "Songs"),
        songsPicker
      )
    );

    // Most-heard view: rows click → Song Insights modal showing every play.
    // Top-per-band view: rows click → Songs page filtered to that artist
    // (preserves existing behavior; the song is just informational here).
    if (songsView === "heard" && topSongs.length > 0) {
      songsCard.appendChild(el("ol", {}, ...topSongs.map((s, i) =>
        el("li", {
          on: { click: () => openSongInsightsModal(s.artist, s.song) },
          style: "cursor:pointer;",
          title: `Click to see every time you heard "${s.song}"`
        },
          el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
          el("span", { class: "name" },
            el("strong", {}, s.song),
            el("span", { class: "song-artist" }, ` — ${s.artist}`)
          ),
          el("span", { class: "count" }, `${s.count}×`)
        )
      )));
    } else if (songsView === "topPerBand" && artistSongLeaders.length > 0) {
      songsCard.appendChild(el("ol", {}, ...artistSongLeaders.map((e, i) =>
        el("li", {
          on: { click: () => {
            location.hash = "#/songs?artist=" + encodeURIComponent(e.artist);
          }},
          style: "cursor:pointer;"
        },
          el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
          el("span", { class: "name" },
            el("strong", {}, e.artist),
            el("span", { class: "song-artist" }, ` — ${e.song}`)
          ),
          el("span", { class: "count" }, `${e.count}×`)
        )
      )));
    }
    songsCard.style.marginTop = "16px";
    app.appendChild(songsCard);
  };


  // "Show buddies" — people I've attended shows with.
  // Two views, switchable via a picker:
  //   - Individual (default): one row per person, ranked by show count.
  //     Includes top-3 bands seen together (sub-line).
  //   - Groups: one row per *exact* attendee combination (2+ people who
  //     went together on the same date). A show with Bill+Josh+Mike contributes
  //     ONLY to the "Bill, Josh, Mike" group, not to "Bill+Josh" or "Josh+Mike."
  //     Filters out solo shows (no attendee names) since those aren't groups.
  // URL param: ?buddiesView=individual|groups
  const buddiesView = (() => {
    const v = (statsParams.get("buddiesView") || "").toLowerCase();
    return v === "groups" ? "groups" : "individual";
  })();

  // Individual buddies + co-seen artists (existing logic)
  const buddyCount = {};
  const buddyArtists = {};  // name -> { artist-norm-key -> { display, count } }
  past.forEach(c => {
    const attendees = splitAttendedWith(c.attendedWith);
    attendees.forEach(n => {
      buddyCount[n] = (buddyCount[n] || 0) + 1;
      allArtistsAtConcert(c).forEach(artistName => {
        const akey = normalizeArtistKey(artistName);
        if (!akey) return;
        if (!buddyArtists[n]) buddyArtists[n] = {};
        if (!buddyArtists[n][akey]) {
          buddyArtists[n][akey] = { display: artistName, count: 0 };
        }
        buddyArtists[n][akey].count++;
      });
    });
  });
  const topBuddiesIndividual = Object.entries(buddyCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Exact groups: keyed by sorted-and-joined attendee names. A show with
  // Bill+Josh on 2024-01-20 contributes to key "Bill||Josh"; a separate show
  // with Bill+Josh+Mike contributes to key "Bill||Josh||Mike" — different group.
  // Solo shows (single attendee) are excluded since the user asked for "groups."
  // Track per-group band counts so we can show a "top bands seen with this group"
  // sub-line, mirroring the individual buddies view's behavior.
  const groupCount = {};
  const groupArtists = {};  // group-key -> { artist-norm-key -> { display, count } }
  past.forEach(c => {
    const attendees = splitAttendedWith(c.attendedWith);
    if (attendees.length < 2) return;  // not a group
    const key = [...attendees].sort().join("||");
    groupCount[key] = (groupCount[key] || 0) + 1;
    allArtistsAtConcert(c).forEach(artistName => {
      const akey = normalizeArtistKey(artistName);
      if (!akey) return;
      if (!groupArtists[key]) groupArtists[key] = {};
      if (!groupArtists[key][akey]) {
        groupArtists[key][akey] = { display: artistName, count: 0 };
      }
      groupArtists[key][akey].count++;
    });
  });
  const topGroups = Object.entries(groupCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Render whichever view is active
  const hasAnyBuddies = topBuddiesIndividual.length > 0 || topGroups.length > 0;
  if (hasAnyBuddies) {
    const buddiesPicker = el("select", {
      class: "leaderboard-role-toggle",
      title: "Switch between individual buddies and exact groups",
      on: { change: e => {
        const next = e.target.value;
        const [route, queryStr] = (location.hash || "#/stats").split("?");
        const p = new URLSearchParams(queryStr || "");
        if (next === "individual") p.delete("buddiesView");
        else p.set("buddiesView", next);
        const newHash = route + (p.toString() ? "?" + p.toString() : "");
        history.replaceState(null, "", newHash);
        renderStats();
      }}
    });
    [
      ["individual", "Individual"],
      ["groups", "Groups"]
    ].forEach(([val, label]) => {
      const o = el("option", { value: val }, label);
      if (val === buddiesView) o.selected = true;
      buddiesPicker.appendChild(o);
    });

    const buddyList = el("div", { class: "top-list" },
      el("div", { class: "leaderboard-header" },
        el("h3", {}, "Show buddies"),
        buddiesPicker
      )
    );

    if (buddiesView === "individual") {
      buddyList.appendChild(el("ol", {}, ...topBuddiesIndividual.map(([name, count], i) => {
        const artistEntries = Object.values(buddyArtists[name] || {})
          .sort((a, b) => b.count - a.count)
          .slice(0, 3);
        const artistSummary = artistEntries.length
          ? artistEntries.map(a =>
              `${a.display}${a.count > 1 ? " ×" + a.count : ""}`
            ).join(" · ")
          : "";

        return el("li", {
          on: { click: () => location.hash = "#/timeline?withPerson=" + encodeURIComponent(name) },
          style: "cursor:pointer;"
        },
          el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
          el("div", { class: "buddy-main" },
            el("div", { class: "buddy-name-row" },
              el("span", { class: "name" }, name),
              el("span", { class: "count" }, `${count} show${count === 1 ? "" : "s"}`)
            ),
            artistSummary
              ? el("div", { class: "buddy-artists" }, artistSummary)
              : null
          )
        );
      })));
    } else {
      // Groups view
      if (topGroups.length === 0) {
        buddyList.appendChild(el("p", { class: "heatmap-desc" },
          "No multi-person groups yet — add attendee names to your concerts to see this view."));
      } else {
        buddyList.appendChild(el("ol", {}, ...topGroups.map(([key, count], i) => {
          const names = key.split("||");
          // Build a comma-separated display label, e.g. "Bill, Josh, Mike"
          const displayLabel = names.join(", ");

          // Top 3 bands this exact group has seen together (mirrors the individual
          // buddies sub-line). Shows what the group's shared concert taste looks like.
          const artistEntries = Object.values(groupArtists[key] || {})
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
          const artistSummary = artistEntries.length
            ? artistEntries.map(a =>
                `${a.display}${a.count > 1 ? " ×" + a.count : ""}`
              ).join(" · ")
            : "";

          // Click goes to Timeline filtered to ALL named members (multi-select).
          // The withPerson param supports multiple values — we encode each separately.
          const params = new URLSearchParams();
          names.forEach(n => params.append("withPerson", n));
          return el("li", {
            on: { click: () => {
              location.hash = "#/timeline?" + params.toString();
            }},
            style: "cursor:pointer;",
            title: `Click to see all shows with ${displayLabel}`
          },
            el("span", { class: "rank" }, String(i + 1).padStart(2, "0")),
            el("div", { class: "buddy-main" },
              el("div", { class: "buddy-name-row" },
                el("span", { class: "name" }, displayLabel),
                el("span", { class: "count" }, `${count} show${count === 1 ? "" : "s"}`)
              ),
              artistSummary
                ? el("div", { class: "buddy-artists" }, artistSummary)
                : null
            )
          );
        })));
      }
    }
    buddyList.style.marginTop = "24px";
    app.appendChild(buddyList);
  }

  // Songs section now renders AFTER Show buddies (per user preference).
  renderSongsSection();

  // ========================================================================
  // Gaps & streaks
  // ========================================================================
  // Sort concerts chronologically (unique dates — same-day shows count once
  // for gap calculations, since the question is "periods with no shows").
  const sortedDates = [...new Set(past.map(c => c.date).filter(Boolean))].sort();
  if (sortedDates.length >= 2) {
    // Longest gap between shows (in days)
    let maxGap = 0, gapStart = "", gapEnd = "";
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1] + "T00:00:00");
      const curr = new Date(sortedDates[i] + "T00:00:00");
      const days = Math.round((curr - prev) / 86400000);
      if (days > maxGap) {
        maxGap = days;
        gapStart = sortedDates[i - 1];
        gapEnd = sortedDates[i];
      }
    }

    // Longest consecutive-year streak (years with at least one show, no gap)
    const yearsWithShows = [...new Set(past.map(c => c.year).filter(Boolean))].sort();
    let maxYearStreak = 1, curYearStreak = 1;
    let yearStreakStart = yearsWithShows[0], yearStreakEnd = yearsWithShows[0];
    let tempStart = yearsWithShows[0];
    for (let i = 1; i < yearsWithShows.length; i++) {
      if (yearsWithShows[i] === yearsWithShows[i - 1] + 1) {
        curYearStreak++;
      } else {
        tempStart = yearsWithShows[i];
        curYearStreak = 1;
      }
      if (curYearStreak > maxYearStreak) {
        maxYearStreak = curYearStreak;
        yearStreakStart = tempStart;
        yearStreakEnd = yearsWithShows[i];
      }
    }

    // Longest consecutive-month streak (months with at least one show)
    const monthsWithShows = [...new Set(past.map(c =>
      c.date ? c.date.slice(0, 7) : null).filter(Boolean))].sort();
    const monthToInt = (ym) => {
      const [y, m] = ym.split("-").map(Number);
      return y * 12 + m;
    };
    let maxMonthStreak = 1, curMonthStreak = 1;
    let monthStreakStart = monthsWithShows[0], monthStreakEnd = monthsWithShows[0];
    let tempMonthStart = monthsWithShows[0];
    for (let i = 1; i < monthsWithShows.length; i++) {
      if (monthToInt(monthsWithShows[i]) === monthToInt(monthsWithShows[i - 1]) + 1) {
        curMonthStreak++;
      } else {
        tempMonthStart = monthsWithShows[i];
        curMonthStreak = 1;
      }
      if (curMonthStreak > maxMonthStreak) {
        maxMonthStreak = curMonthStreak;
        monthStreakStart = tempMonthStart;
        monthStreakEnd = monthsWithShows[i];
      }
    }

    const formatYM = (ym) => {
      const [y, m] = ym.split("-");
      const d = new Date(Number(y), Number(m) - 1, 1);
      return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    };

    const streaksCard = el("div", { class: "top-list streaks-card" },
      el("h3", {}, "Gaps & streaks"),
      el("div", { class: "streaks-grid" },
        el("div", { class: "streak-item" },
          el("div", { class: "streak-label" }, "Longest gap between shows"),
          el("div", { class: "streak-value" }, maxGap + " days"),
          el("div", { class: "streak-detail" },
            formatDate(gapStart) + " → " + formatDate(gapEnd))
        ),
        el("div", { class: "streak-item" },
          el("div", { class: "streak-label" }, "Longest consecutive-year streak"),
          el("div", { class: "streak-value" }, maxYearStreak + " year" + (maxYearStreak === 1 ? "" : "s")),
          el("div", { class: "streak-detail" },
            yearStreakStart + " → " + yearStreakEnd)
        ),
        el("div", { class: "streak-item" },
          el("div", { class: "streak-label" }, "Longest consecutive-month streak"),
          el("div", { class: "streak-value" }, maxMonthStreak + " month" + (maxMonthStreak === 1 ? "" : "s")),
          el("div", { class: "streak-detail" },
            formatYM(monthStreakStart) + " → " + formatYM(monthStreakEnd))
        )
      )
    );
    streaksCard.style.marginTop = "24px";
    app.appendChild(streaksCard);
  }

  // Monthly heatmap: rows = years, cols = months (Jan-Dec).
  // Cell darkness scales globally — the single busiest month across all years
  // is 100% intensity; everything else is proportional.
  const heatData = {};        // year -> month (1-12) -> count
  let heatMaxAll = 0;         // max count across all years/months
  past.forEach(c => {
    if (!c.date || !c.year) return;
    const m = Number(c.date.slice(5, 7));
    if (!heatData[c.year]) heatData[c.year] = {};
    heatData[c.year][m] = (heatData[c.year][m] || 0) + 1;
    if (heatData[c.year][m] > heatMaxAll) heatMaxAll = heatData[c.year][m];
  });
  const heatYears = Object.keys(heatData).sort();
  if (heatYears.length > 0 && heatMaxAll > 0) {
    const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const heatCard = el("div", { class: "top-list heatmap-card" },
      el("h3", {}, "Concert heatmap")
    );
    heatCard.appendChild(el("p", { class: "heatmap-desc" },
      "Darker = busier month overall. Click a cell to filter."));

    const table = el("div", { class: "heatmap-table" });

    // Header row with month abbreviations
    const headRow = el("div", { class: "heatmap-row heatmap-head" },
      el("div", { class: "heatmap-year-label" }, "")
    );
    MONTH_ABBR.forEach(m => {
      headRow.appendChild(el("div", { class: "heatmap-cell heatmap-month-label" }, m));
    });
    table.appendChild(headRow);

    // Data rows
    heatYears.forEach(y => {
      const row = el("div", { class: "heatmap-row" },
        el("div", { class: "heatmap-year-label" }, y)
      );
      for (let m = 1; m <= 12; m++) {
        const count = (heatData[y] && heatData[y][m]) || 0;
        // Single global scale (across all years). Floor at 0.15 so a single
        // show is still visible against the much-larger max from busy months.
        const intensity = count === 0 ? 0 : Math.max(0.15, count / heatMaxAll);
        const cellTitle = count === 0
          ? `${MONTH_ABBR[m - 1]} ${y}: no shows`
          : `${MONTH_ABBR[m - 1]} ${y}: ${count} show${count === 1 ? "" : "s"}`;
        const cell = el("div", {
          class: "heatmap-cell" + (count > 0 ? " has-shows" : ""),
          title: cellTitle,
          style: count > 0 ? `--intensity:${intensity};` : "",
          on: count > 0 ? {
            click: () => {
              // Navigate to the Timeline showing just that year (no month filter yet)
              location.hash = "#/timeline";
              // After render, scroll to the year
              setTimeout(() => {
                const anchor = document.getElementById("year-" + y);
                if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
              }, 150);
            }
          } : {}
        });
        if (count > 0) {
          cell.appendChild(el("span", { class: "heatmap-count" }, String(count)));
        }
        row.appendChild(cell);
      }
      table.appendChild(row);
    });
    heatCard.appendChild(table);
    heatCard.style.marginTop = "24px";
    app.appendChild(heatCard);
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
   ABOUT VIEW
   Static-content page with Seth's bio, story, and contact info.
   The "What this site is" paragraph pulls live counts from STATE
   so the numbers stay accurate as new shows/posters are added.
   Photo gallery is stubbed via a constant array; populate the
   ABOUT_PHOTOS list with image paths to enable the gallery.
   ============================================================ */

// Photos for the About page. Each entry has:
//   - src: path to the image (drop files into images/about/)
//   - alt: alt text for accessibility (defaults to the auto-caption if not set)
//   - caption: optional short label shown below the photo. If omitted, the
//     date is auto-derived from the timestamp embedded in the filename and
//     used as the caption (e.g., "January 2014"). Override the caption per
//     photo to add real context like "Rock on the Range, 2018."
//
// Source filenames are kept as-is (Pixel/Samsung timestamp format) so we
// don't have to rename files manually. The layout sorts chronologically by
// the embedded timestamp.
const ABOUT_PHOTOS = [
  { src: "images/about/20140130_223458.jpg" },
  { src: "images/about/20140811_195752.jpg" },
  { src: "images/about/20140917_194606.jpg" },
  { src: "images/about/IMG_20150731_220108620.jpg" },
  { src: "images/about/20171010_220039.jpg" },
  { src: "images/about/20171010_223416.jpg" },
  { src: "images/about/20180424_213621.jpg" },
  { src: "images/about/20190312_214748.jpg" },
  { src: "images/about/20200208_213414.jpg" },
  { src: "images/about/20220222_225814.jpg" },
  { src: "images/about/20220622_221750.jpg" },
  { src: "images/about/20220927_223449.jpg" },
  { src: "images/about/PXL_20230909_000133262.jpg" },
  { src: "images/about/PXL_20231015_052313979.jpg" },
  { src: "images/about/PXL_20240122_033607454.jpg" },
  { src: "images/about/PXL_20240218_205053163.jpg" },
  { src: "images/about/PXL_20240408_022234697.MP.jpg" },
  { src: "images/about/PXL_20240520_013741498.jpg" },
  { src: "images/about/PXL_20250601_023753531.jpg" },
  { src: "images/about/PXL_20250822_001543892.jpg" },
  { src: "images/about/PXL_20250906_014050081.MP.jpg" },
];

/**
 * Auto-derive a caption from a photo filename's embedded timestamp.
 * Handles formats: "20240520_013741498.jpg", "PXL_20240520_013741498.jpg",
 * "IMG_20150731_220108620.jpg". Returns "May 2024" or similar.
 * Falls back to empty string if no recognizable date is found.
 */
function aboutPhotoAutoCaption(src) {
  const m = src.match(/(\d{4})(\d{2})\d{2}/);
  if (!m) return "";
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const months = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  if (monthIdx < 0 || monthIdx > 11) return year;
  return `${months[monthIdx]} ${year}`;
}

function renderAbout() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  // Compute live stats so the bio's "What this site is" sentence stays current.
  // Uses the past-only concerts (already filtered to exclude future-dated shows
  // at load time) and the full poster collection.
  const concertCount = STATE.concerts ? STATE.concerts.length : 0;
  const posterCount = STATE.posters ? STATE.posters.length : 0;
  const earliestYear = (() => {
    if (!STATE.concerts || STATE.concerts.length === 0) return null;
    const years = STATE.concerts.map(c => c.year).filter(Boolean);
    return years.length ? Math.min(...years) : null;
  })();
  const sinceYearText = earliestYear ? `since ${earliestYear}` : "across the years";

  app.appendChild(el("div", { class: "view-header" },
    el("h2", { class: "view-title" },
      "About ",
      el("span", { class: "accent" }, "Seth")
    ),
    el("p", { class: "view-sub" }, "The story behind the archive.")
  ));

  const wrap = el("div", { class: "about-page" });

  // Helper: build the horizontal photo strip. Sits at the very top of the
  // About page, before the lead paragraph. Compact tiles preserve natural
  // aspect ratios; click any tile to open the photo at full size in the
  // existing lightbox component.
  //
  // Captions show on hover (desktop, where hover exists) and always on
  // touch devices via a CSS media query that flips the rules.
  //
  // Fade gradients on the left/right edges signal scrollable content
  // without adding clutter (no arrow buttons, no auto-scroll).
  const buildGallery = () => {
    if (ABOUT_PHOTOS.length === 0) return null;
    const section = el("section", { class: "about-strip-section" });
    // Visual wrapper wraps the scrolling track + the fade overlays. The
    // track itself is the only thing that scrolls.
    const stripWrap = el("div", { class: "about-strip-wrap" });
    const track = el("div", { class: "about-strip-track" });

    ABOUT_PHOTOS.forEach(photo => {
      const fig = el("figure", { class: "about-strip-tile" });
      const caption = photo.caption || aboutPhotoAutoCaption(photo.src);
      const altText = photo.alt || caption || "About Seth photo";
      const img = el("img", {
        src: photo.src,
        alt: altText,
        loading: "lazy",
        on: {
          // Hide the tile if the image fails to load (e.g. file missing)
          error: function() { fig.style.display = "none"; }
        }
      });
      fig.appendChild(img);
      if (caption) {
        fig.appendChild(el("figcaption", { class: "about-strip-caption" }, caption));
      }
      // Click the tile (anywhere on it) opens the full-size photo in lightbox.
      // Use the figure as the click target so the caption is also clickable.
      fig.addEventListener("click", () => openLightbox(photo.src, altText));
      fig.style.cursor = "zoom-in";
      track.appendChild(fig);
    });

    stripWrap.appendChild(track);
    // Fade overlays — purely decorative, pointer-events: none in CSS so
    // they don't block scroll/click on the track underneath.
    stripWrap.appendChild(el("div", { class: "about-strip-fade about-strip-fade-left" }));
    stripWrap.appendChild(el("div", { class: "about-strip-fade about-strip-fade-right" }));

    section.appendChild(stripWrap);
    return section;
  };

  // Photo strip sits at the very top of the About page, above the bio.
  // Sets a visual tone before the words start.
  const galleryEl = buildGallery();
  if (galleryEl) wrap.appendChild(galleryEl);

  // Lead paragraph
  wrap.appendChild(el("p", { class: "about-lead" },
    "I'm Seth from Raleigh, NC. This site is my live music journey, made physical. ",
    "A passion project years in the making, focused on the live shows I've attended ",
    "and the poster collection I've built."
  ));

  // Section: Why this exists
  wrap.appendChild(el("h3", { class: "about-section" }, "Why this exists"));
  wrap.appendChild(el("p", {},
    "I lost a parent when I was young, and that loss has shaped everything since. ",
    "It made me want to live deliberately. To say yes to experiences and not put things off."
  ));
  wrap.appendChild(el("p", {},
    "Music was the thing that came with me through all of it. While other kids were ",
    "reading books, I was listening to albums front-to-back, over and over. Long car ",
    "rides, doing homework, working through whatever I was working through, music was ",
    "always running. The 90s rock scene (what people now affectionately call \"dad rock\") ",
    "hit me hard and never let go. I played baritone horn from middle school through ",
    "my first year in college, but the bigger thing was just listening. Albums were the ",
    "language I was fluent in."
  ));

  // Section: The shows that lit the fuse
  wrap.appendChild(el("h3", { class: "about-section" }, "The shows that lit the fuse"));
  wrap.appendChild(el("p", {},
    "In college I joined my local station, 90.7 WXIN in Providence, RI. ",
    "I developed a relationship with Lupos, the local music venue, and we'd ",
    "get tickets to shows for listeners and staff. I went to a lot of them. ",
    "Some I remember vividly. Others, the details are a bit more vague."
  ));
  wrap.appendChild(el("p", {},
    "A few years later, the spark was a Faith No More show in New York, for their ",
    "reunion tour. I travelled to NY with three friends who loved the band as much as ",
    "I did, and something clicked. After that, I'd find ways to fit shows in around ",
    "raising a family and a career. Work travel became opportunity travel: a meeting ",
    "in another city was a chance to catch a show I couldn't see at home with friends."
  ));
  wrap.appendChild(el("p", {},
    "Then came Rock on the Range, my first festival. Camping with friends, three days ",
    "of bands I loved back-to-back, perfect weather, the whole thing. I came home ",
    "knowing I needed more of that in my life. Festivals get harder to pull off as you ",
    "get older, but every one I make it to is a deliberate choice to keep showing up ",
    "for the things that matter."
  ));

  // Section: Why I keep going
  wrap.appendChild(el("h3", { class: "about-section" }, "Why I keep going"));
  wrap.appendChild(el("p", {},
    "There are artists I'll never get to see live. Chester Bennington. Tom Petty. ",
    "Chris Cornell. Kurt Cobain. Vinny Paul. I think about that list a lot."
  ));
  wrap.appendChild(el("p", {},
    "So when an artist I love comes through town or is in a decent travelable location, ",
    "I go. When a festival announces a lineup that hits, I'm going to try to get there. ",
    "The list of who I haven't seen yet is longer than the list of who I have, and ",
    "that's the whole point."
  ));

  // Section: What this site is — with live counts
  wrap.appendChild(el("h3", { class: "about-section" }, "What this site is"));
  wrap.appendChild(el("p", {},
    "Sethlist is an archive of every show I've been to: ",
    el("strong", {}, `${concertCount} concerts ${sinceYearText}`),
    ", plus ",
    el("strong", {}, `${posterCount} posters`),
    " from those shows. Five views: timeline, map, posters, setlists, stats. All of ",
    "it is from my own data, none of it is generic."
  ));
  wrap.appendChild(el("p", {},
    "The poster collection started during COVID lockdown. With no shows to attend, ",
    "I started looking back at what posters existed for the shows I'd already been to. ",
    "Could I track them down? It became a project: physical keepsakes for every show ",
    "I'd been to, then every show going forward. Some are signed. Some are limited ",
    "editions. Some I'm still hunting for."
  ));

  // Section: How this was built
  wrap.appendChild(el("h3", { class: "about-section" }, "A note on how this was built"));
  wrap.appendChild(el("p", {},
    "I'm not an engineer. I'm a SaaS CX leader who knows enough about software to be ",
    "dangerous. But I wanted to see what was possible when someone with a clear vision ",
    "and patience for iteration paired up with the right AI tools."
  ));
  wrap.appendChild(el("p", {},
    "This entire site, from data pipeline to interactive heatmap to that scrolling ",
    "poster marquee at the top of the Posters page, was built in collaboration with ",
    "Claude and Gemini. It's bespoke, tailored to me, and not really meant to be ",
    "replicated. But it's a small example of what one person with an idea can now make real."
  ));

  // Section: Get in touch
  wrap.appendChild(el("h3", { class: "about-section" }, "Get in touch"));
  wrap.appendChild(el("p", {},
    "Have we seen a show at the same time? Are you an artist whose poster I have, ",
    "a venue I've been to, a festival promoter, or someone who just wants to talk about ",
    "live music? ",
    el("a", { class: "accent-link", href: "mailto:seth@sethlist.live" }, "seth@sethlist.live"),
    ". I read everything."
  ));
  wrap.appendChild(el("p", {},
    "If you're going to a show and want company, even better."
  ));

  app.appendChild(wrap);
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
  // Priority: close the topmost thing first. Lightbox > modal > screensaver-is-handled-separately.
  if (closeLightbox()) return;
  closeModal();
});

/**
 * Central modal state. When a modal opens, the opener records:
 *   - kind: "concert" | "poster"
 *   - id:   the identifier (concert.id or poster group's primary poster id)
 *   - list: the ordered array of items the user can navigate through
 *           (e.g., the currently-filtered concerts from the Timeline, or
 *           the currently-filtered poster groups from the Posters page)
 *   - index: current position in list
 * This enables:
 *   - Arrow-key navigation (prev/next within the current filter)
 *   - Deep-linkable URLs (hash parameter updates with modal state)
 */
const MODAL_STATE = {
  kind: null,       // "concert" | "poster" | null
  id: null,
  list: null,
  index: -1,
};

function openModal() {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
  // Clean up deep-link param from URL without triggering a full re-render
  const [route, queryStr] = (location.hash || "#/timeline").split("?");
  const params = new URLSearchParams(queryStr || "");
  if (params.has("modal")) {
    params.delete("modal");
    const newHash = route + (params.toString() ? "?" + params.toString() : "");
    // Use replaceState to avoid an extra history entry
    history.replaceState(null, "", newHash);
  }
  MODAL_STATE.kind = null;
  MODAL_STATE.id = null;
  MODAL_STATE.list = null;
  MODAL_STATE.index = -1;
}

/* ============================================================
   SCREENSAVER MODE
   Full-screen rotating display of stock poster images. Cycles every
   30 seconds (or on spacebar). Any key or click exits.
   ============================================================ */

let _screensaverEl = null;
let _screensaverTimer = null;
let _screensaverIdx = 0;
let _screensaverList = null;

const SCREENSAVER_INTERVAL_MS = 30000;  // 30 seconds per poster

/**
 * Build the eligible poster list: every poster with a resolvable stock image.
 * We don't pre-verify the URL works — the <img> onerror handler advances to
 * the next poster so a broken image doesn't wedge the screensaver on one slide.
 */
function buildScreensaverList() {
  const out = [];
  for (const p of STATE.posters) {
    // Prefer stock — if there's no stock URL at all, skip.
    const src = posterImageSrc(p, "stock");
    const hasLocal = true;  // may still resolve to images/stock/poster-<id>.jpg
    if (src || hasLocal) {
      out.push(p);
    }
  }
  // Shuffle so each session feels different
  return out.sort(() => Math.random() - 0.5);
}

function startScreensaver() {
  const list = buildScreensaverList();
  if (list.length === 0) return;
  _screensaverList = list;
  _screensaverIdx = 0;

  if (!_screensaverEl) {
    _screensaverEl = el("div", {
      class: "screensaver",
      hidden: true,
      tabindex: "0",  // receive focus for keydown
      on: {
        click: () => stopScreensaver(),
      }
    });
    const caption = el("div", { class: "screensaver-caption" });
    const img = el("img", { class: "screensaver-img", src: "", alt: "" });
    const hint = el("div", { class: "screensaver-hint" }, "Press any key or click to exit · space for next");
    _screensaverEl.appendChild(img);
    _screensaverEl.appendChild(caption);
    _screensaverEl.appendChild(hint);
    document.body.appendChild(_screensaverEl);
  }
  _screensaverEl.hidden = false;
  document.body.style.overflow = "hidden";
  _screensaverEl.focus();
  showScreensaverPoster();
  _screensaverTimer = setInterval(advanceScreensaver, SCREENSAVER_INTERVAL_MS);
}

function showScreensaverPoster() {
  if (!_screensaverEl || !_screensaverList) return;
  const p = _screensaverList[_screensaverIdx];
  const img = _screensaverEl.querySelector(".screensaver-img");
  const caption = _screensaverEl.querySelector(".screensaver-caption");

  // Build a fallback chain so broken images auto-advance rather than stalling
  const tries = [
    posterImageSrc(p, "stock"),
    `images/stock/poster-${p.id}.jpg`,
  ].filter((v, i, a) => v && a.indexOf(v) === i);
  let attempt = 0;
  img.onerror = () => {
    attempt++;
    if (attempt < tries.length) {
      img.src = tries[attempt];
    } else {
      // This poster can't be shown — skip ahead
      setTimeout(advanceScreensaver, 300);
    }
  };
  img.src = tries[0] || "";
  img.alt = `${p.artist} poster`;
  caption.textContent = `${p.artist} · ${formatDate(p.date)}${p.location ? " · " + p.location : ""}`;
}

function advanceScreensaver() {
  if (!_screensaverList) return;
  _screensaverIdx = (_screensaverIdx + 1) % _screensaverList.length;
  showScreensaverPoster();
}

function stopScreensaver() {
  if (!_screensaverEl || _screensaverEl.hidden) return;
  _screensaverEl.hidden = true;
  document.body.style.overflow = "";
  if (_screensaverTimer) {
    clearInterval(_screensaverTimer);
    _screensaverTimer = null;
  }
}

// Any keypress while screensaver is open exits (space advances to next instead)
document.addEventListener("keydown", e => {
  if (!_screensaverEl || _screensaverEl.hidden) return;
  if (e.key === " " || e.key === "ArrowRight") {
    e.preventDefault();
    advanceScreensaver();
    return;
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    _screensaverIdx = (_screensaverIdx - 1 + _screensaverList.length) % _screensaverList.length;
    showScreensaverPoster();
    return;
  }
  // Any other key exits
  e.preventDefault();
  stopScreensaver();
});

/**
 * Update the URL hash to include modal=<id> so the current modal is
 * deep-linkable. Uses replaceState so we don't accumulate history entries
 * as the user arrow-keys through posters.
 */
function setModalDeepLink(kind, id) {
  const [route, queryStr] = (location.hash || "#/timeline").split("?");
  const params = new URLSearchParams(queryStr || "");
  params.set("modal", String(id));
  const newHash = route + "?" + params.toString();
  history.replaceState(null, "", newHash);
}

/**
 * Navigate to the previous/next item in the current modal's list.
 * No-op if there's no list or we're already at the boundary.
 */
function navigateModal(direction) {
  if (!MODAL_STATE.list || MODAL_STATE.list.length === 0) return;
  const next = MODAL_STATE.index + direction;
  if (next < 0 || next >= MODAL_STATE.list.length) return;
  const item = MODAL_STATE.list[next];
  if (MODAL_STATE.kind === "concert") {
    openConcertModal(item, { list: MODAL_STATE.list, index: next });
  } else if (MODAL_STATE.kind === "poster") {
    openPosterModal(item, { list: MODAL_STATE.list, index: next });
  }
}

// Arrow-key navigation — left/right walks the current modal's list
document.addEventListener("keydown", e => {
  // Ignore if a text field has focus (so filter search boxes still work)
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (modal.hidden) return;
  if (_lightboxEl && !_lightboxEl.hidden) return;  // lightbox open: don't steal arrows
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    navigateModal(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    navigateModal(1);
  }
});

/* ============================================================
   KEYBOARD SHORTCUTS OVERLAY
   Press '?' anywhere to bring up a list of available shortcuts.
   Press '?' or Esc to dismiss. Available globally on every view.
   ============================================================ */

let _shortcutsEl = null;

function buildShortcutsOverlay() {
  // Sections of shortcuts grouped by context. Each row is [keys, description].
  const sections = [
    {
      title: "Anywhere",
      rows: [
        ["?", "Show / hide this overlay"],
        ["Esc", "Close overlay, modal, or lightbox"],
      ]
    },
    {
      title: "When a poster or concert modal is open",
      rows: [
        ["←  /  →", "Walk to previous / next item in the current filter"],
        ["Esc", "Close modal"],
      ]
    },
    {
      title: "Posters view",
      rows: [
        ["🎲 Random button", "Open a random poster from the current filter"],
        ["🖼 Screensaver button", "Full-screen rotating poster display"],
      ]
    },
    {
      title: "When the screensaver is running",
      rows: [
        ["Space  /  →", "Advance to next poster"],
        ["←", "Go back to previous poster"],
        ["Any other key", "Exit the screensaver"],
      ]
    },
  ];

  const overlay = el("div", {
    class: "shortcuts-overlay",
    hidden: true,
    on: {
      click: e => {
        // Click on backdrop closes; click on inner card doesn't
        if (e.target === overlay) closeShortcutsOverlay();
      }
    }
  });
  const card = el("div", { class: "shortcuts-card" });
  card.appendChild(el("button", {
    class: "shortcuts-close",
    "aria-label": "Close",
    on: { click: () => closeShortcutsOverlay() }
  }, "✕"));
  card.appendChild(el("h3", { class: "shortcuts-title" }, "Keyboard shortcuts"));

  sections.forEach(section => {
    const sec = el("div", { class: "shortcuts-section" });
    sec.appendChild(el("div", { class: "shortcuts-section-title" }, section.title));
    const list = el("dl", { class: "shortcuts-list" });
    section.rows.forEach(([keys, desc]) => {
      list.appendChild(el("dt", { class: "shortcuts-keys" }, keys));
      list.appendChild(el("dd", { class: "shortcuts-desc" }, desc));
    });
    sec.appendChild(list);
    card.appendChild(sec);
  });

  card.appendChild(el("div", { class: "shortcuts-footer" },
    "Press ? again or Esc to close"));
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  return overlay;
}

function openShortcutsOverlay() {
  if (!_shortcutsEl) _shortcutsEl = buildShortcutsOverlay();
  _shortcutsEl.hidden = false;
}
function closeShortcutsOverlay() {
  if (_shortcutsEl) _shortcutsEl.hidden = true;
}

// Global '?' key toggles the overlay; Esc dismisses it. We listen at capture
// phase so this runs before any view-specific handlers. Suppress when the
// user is typing in an input field — '?' belongs in their query, not as a
// shortcut.
document.addEventListener("keydown", e => {
  const t = e.target;
  const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  // Don't trigger when modal/lightbox/screensaver is open — those have their
  // own key handling, and adding the overlay on top would be visually noisy.
  const otherModalOpen = (modal && !modal.hidden) ||
    (_lightboxEl && !_lightboxEl.hidden) ||
    (_screensaverEl && !_screensaverEl.hidden);

  if (e.key === "?" && !inField && !otherModalOpen) {
    e.preventDefault();
    if (_shortcutsEl && !_shortcutsEl.hidden) {
      closeShortcutsOverlay();
    } else {
      openShortcutsOverlay();
    }
    return;
  }
  // Esc closes the overlay (also handled by document-level Escape elsewhere,
  // but adding here ensures it works even before other handlers attach)
  if (e.key === "Escape" && _shortcutsEl && !_shortcutsEl.hidden) {
    e.preventDefault();
    closeShortcutsOverlay();
  }
});

/**
 * Helper: open a concert modal with navigation context pulled from whatever
 * list is currently on STATE (the Timeline's filtered list). Falls back to
 * opening without a list if we can't find the concert in the stashed list.
 */
function openConcertModalWithNav(c) {
  const list = STATE._timelineNavList;
  if (list && Array.isArray(list)) {
    const idx = list.findIndex(x => x.id === c.id);
    if (idx >= 0) {
      openConcertModal(c, { list, index: idx });
      return;
    }
  }
  openConcertModal(c);
}

/**
 * Helper: open a poster modal with nav context from STATE._posterNavList.
 */
function openPosterModalWithNav(g) {
  const list = STATE._posterNavList;
  if (list && Array.isArray(list)) {
    // Match groups by the primary poster id (groups may be new objects on re-render,
    // but the underlying poster ids are stable).
    const primaryId = g.posters && g.posters[0] ? g.posters[0].id : null;
    const idx = list.findIndex(x =>
      x.posters && x.posters[0] && x.posters[0].id === primaryId);
    if (idx >= 0) {
      openPosterModal(g, { list, index: idx });
      return;
    }
  }
  openPosterModal(g);
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
/* ============================================================
   ARTIST INSIGHTS MODAL
   Opened from the "Most-seen artists" leaderboard. Shows when the
   user saw a given artist: a year-strip mini-heatmap (one cell per
   year you saw them), a list of shows, and a link to filter the
   Timeline to that artist.
   ============================================================ */

/**
 * Find every concert that featured a given artist (by normalized key match).
 * Includes both headliner appearances and opener appearances.
 */
function concertsFeaturingArtist(artistName) {
  const targetKey = normalizeArtistKey(artistName);
  if (!targetKey) return [];
  return STATE.concerts.filter(c => {
    return allArtistsAtConcert(c)
      .some(name => normalizeArtistKey(name) === targetKey);
  }).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
}

/**
 * Open a small modal listing all festivals the user has attended. Each
 * festival entry shows the name, year span, and total day count. Clicking
 * a festival navigates to the Timeline filtered to that festival.
 */
function openFestivalsListModal() {
  // Group concerts by festivalKey to find each festival's day range
  const byFest = {};
  STATE.concerts.forEach(c => {
    if (!c.festivalKey) return;
    if (!byFest[c.festivalKey]) {
      byFest[c.festivalKey] = {
        key: c.festivalKey,
        name: c.festivalName || c.festivalKey,
        dates: [],
        totalDays: 0,
      };
    }
    byFest[c.festivalKey].dates.push(c.date);
    byFest[c.festivalKey].totalDays++;
  });
  const festivals = Object.values(byFest)
    // Sort chronologically (earliest first) — matches Timeline filter order
    .sort((a, b) => {
      const aDate = a.dates.length ? a.dates.sort()[0] : "";
      const bDate = b.dates.length ? b.dates.sort()[0] : "";
      return aDate.localeCompare(bDate);
    });

  MODAL_STATE.kind = "festivalsList";
  MODAL_STATE.id = null;
  MODAL_STATE.list = null;
  MODAL_STATE.index = -1;

  modalBody.innerHTML = "";
  modalBody.appendChild(el("div", { class: "modal-eyebrow artist-eyebrow" }, "FESTIVALS"));
  modalBody.appendChild(el("h2", { class: "modal-title" }, "Festivals attended"));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    `${festivals.length} festival${festivals.length === 1 ? "" : "s"}, ${festivals.reduce((s, f) => s + f.totalDays, 0)} festival days total`));

  if (festivals.length === 0) {
    modalBody.appendChild(el("p", { class: "artist-strip-desc" }, "No festivals logged yet."));
    openModal();
    return;
  }

  const list = el("div", { class: "artist-show-list" });
  festivals.forEach(f => {
    const dates = [...f.dates].sort();
    const earliestDate = dates[0];
    const latestDate = dates[dates.length - 1];
    const dateRange = earliestDate === latestDate
      ? formatDate(earliestDate)
      : `${formatDate(earliestDate)} → ${formatDate(latestDate)}`;
    list.appendChild(el("div", {
      class: "artist-show-item",
      on: { click: () => {
        closeModal();
        setTimeout(() => {
          location.hash = "#/timeline?festival=" + encodeURIComponent(f.key);
        }, 50);
      }}
    },
      el("div", { class: "artist-show-date" }, dateRange),
      el("div", { class: "artist-show-meta" },
        el("span", { class: "artist-show-venue" }, f.name),
        el("span", { class: "artist-show-role" },
          `${f.totalDays} day${f.totalDays === 1 ? "" : "s"} attended`)
      )
    ));
  });
  modalBody.appendChild(list);

  openModal();
}

/**
 * Open a modal showing the bands heatmap — every band the user has seen
 * 2+ times, sized/colored by show count. Clicking a band tile opens the
 * Band Insights modal for that band.
 *
 * @param {object} artistCountByKey - Map of normalized artist key to show count
 * @param {function} canonicalDisplay - Function returning the canonical display name for a key
 * @param {string} initialRole - Current role filter ("all" | "headliner" | "opener")
 */
function openBandsHeatmapModal(artistCountByKey, canonicalDisplay, initialRole) {
  // Mark modal state. This isn't a navigable modal (no prev/next), so we
  // don't set list/index — keyboard arrows do nothing here.
  MODAL_STATE.kind = "bandsHeatmap";
  MODAL_STATE.id = null;
  MODAL_STATE.list = null;
  MODAL_STATE.index = -1;

  const bands = Object.entries(artistCountByKey)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ name: canonicalDisplay(key), count }));

  modalBody.innerHTML = "";
  modalBody.appendChild(el("div", { class: "modal-eyebrow artist-eyebrow" }, "BANDS HEATMAP"));
  modalBody.appendChild(el("h2", { class: "modal-title" }, "All bands, sized by shows"));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    `${bands.length} band${bands.length === 1 ? "" : "s"} you've seen 2+ times. Click any tile for details.`));

  if (bands.length === 0) {
    modalBody.appendChild(el("p", { class: "artist-strip-desc" },
      "No bands match the current role filter."));
    openModal();
    return;
  }

  const maxBandCount = bands[0].count;  // sorted desc

  const grid = el("div", { class: "bands-heatmap-grid bands-heatmap-grid-modal" });
  bands.forEach(({ name, count }) => {
    const intensity = Math.max(0.25, count / maxBandCount);
    const sizeScale = 0.7 + (count / maxBandCount) * 0.6;
    const tile = el("div", {
      class: "band-tile",
      style: `--intensity:${intensity};--size-scale:${sizeScale};`,
      title: `${name}: ${count} show${count === 1 ? "" : "s"}`,
      on: { click: () => {
        // Close this modal and open the band insights modal. Defer slightly
        // so the previous modal's state cleans up before the new one opens.
        closeModal();
        setTimeout(() => openArtistInsightsModal(name), 60);
      }}
    },
      el("span", { class: "band-tile-name" }, name),
      el("span", { class: "band-tile-count" }, `${count}×`)
    );
    grid.appendChild(tile);
  });
  modalBody.appendChild(grid);

  openModal();
}

/**
 * Open a heatmap modal for venues or cities. Same visual pattern as the
 * Bands heatmap: a flex grid of tiles, each sized and colored by visit count.
 * Clicking a tile triggers the entry's existing onClick (Timeline filter).
 *
 * @param {string} kind - "venues" or "cities" (used for header label only)
 * @param {Array} entries - Array of [label, count, onClick] tuples (sorted desc)
 */
function openPlacesHeatmapModal(kind, entries) {
  if (!entries || entries.length === 0) return;

  MODAL_STATE.kind = "placesHeatmap";
  MODAL_STATE.id = null;
  MODAL_STATE.list = null;
  MODAL_STATE.index = -1;

  const titleByKind = {
    venues: "All venues, sized by visits",
    cities: "All cities, sized by visits",
  };
  const eyebrow = kind === "venues" ? "VENUES HEATMAP" : "CITIES HEATMAP";
  const title = titleByKind[kind] || "Places heatmap";

  // The Stats card only shows top 12. The modal pulls from the same dataset
  // but isn't artificially capped — show everything the user has visited.
  // For the modal we want the FULL list, not the truncated leaderboard.
  // entries here is already capped to 12 by the caller; we'd need the full
  // list. For now we'll use what was passed in and note it; a fuller version
  // could re-derive from STATE.concerts.
  const maxCount = entries[0][1];

  modalBody.innerHTML = "";
  modalBody.appendChild(el("div", { class: "modal-eyebrow artist-eyebrow" }, eyebrow));
  modalBody.appendChild(el("h2", { class: "modal-title" }, title));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    `${entries.length} ${kind} you've visited 2+ times. Click any tile to filter the Timeline.`));

  const grid = el("div", { class: "bands-heatmap-grid bands-heatmap-grid-modal" });
  entries.forEach(([label, count, onClick]) => {
    const intensity = Math.max(0.25, count / maxCount);
    const sizeScale = 0.7 + (count / maxCount) * 0.6;
    const tile = el("div", {
      class: "band-tile",
      style: `--intensity:${intensity};--size-scale:${sizeScale};`,
      title: `${label}: ${count} show${count === 1 ? "" : "s"}`,
      on: { click: () => {
        // Close the modal first so the navigation feels clean
        closeModal();
        setTimeout(() => onClick(), 50);
      }}
    },
      el("span", { class: "band-tile-name" }, label),
      el("span", { class: "band-tile-count" }, `${count}×`)
    );
    grid.appendChild(tile);
  });
  modalBody.appendChild(grid);

  openModal();
}

/**
 * Open a modal showing every time the user heard a specific song live.
 * Lists each play with date, venue, and the band that played it.
 * Useful for answering "when did I hear Sober?" — the X-ray view.
 *
 * @param {string} artist - Display name of the artist whose song this is
 * @param {string} song - Song title (case-sensitive match)
 */
function openSongInsightsModal(artist, song) {
  // Find every performance of this song. Iterates all setlist data and
  // matches on artist normalized key + case-insensitive song title.
  const targetArtKey = normalizeArtistKey(artist);
  const songLower = song.toLowerCase();
  const plays = [];
  for (const perf of iterAllSongPerformances()) {
    if (normalizeArtistKey(perf.artist) !== targetArtKey) continue;
    if ((perf.song || "").toLowerCase() !== songLower) continue;
    plays.push(perf);
  }
  if (plays.length === 0) return;

  // Sort chronologically (earliest first) so the user can see how the song
  // has accompanied them over time.
  plays.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  MODAL_STATE.kind = "songInsights";
  MODAL_STATE.id = `${artist}::${song}`;
  MODAL_STATE.list = null;
  MODAL_STATE.index = -1;

  modalBody.innerHTML = "";
  modalBody.appendChild(el("div", { class: "modal-eyebrow artist-eyebrow" }, "SONG INSIGHTS"));
  modalBody.appendChild(el("h2", { class: "modal-title" }, song));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    `${artist} · heard ${plays.length} time${plays.length === 1 ? "" : "s"}`));

  // Build a list of every play. Click a row → opens the underlying concert modal.
  const list = el("div", { class: "artist-show-list" });
  plays.forEach(perf => {
    // Find the concert this performance came from (perf.date + perf.artist match)
    const concert = STATE.concerts.find(c =>
      c.date === perf.date &&
      (normalizeArtistKey(c.artist) === targetArtKey ||
       splitActs(c.openingActs).some(a => normalizeArtistKey(a) === targetArtKey))
    );
    const venueText = concert
      ? [concert.venue, concert.city, concert.state].filter(Boolean).join(", ")
      : "Unknown venue";
    const roleText = perf.role === "headliner"
      ? null
      : (perf.role === "opener" ? "as opener" : null);

    list.appendChild(el("div", {
      class: "artist-show-item",
      on: { click: () => {
        if (concert) {
          closeModal();
          setTimeout(() => openConcertModal(concert), 50);
        }
      }}
    },
      el("div", { class: "artist-show-date" }, formatDate(perf.date)),
      el("div", { class: "artist-show-meta" },
        el("span", { class: "artist-show-venue" }, venueText),
        roleText ? el("span", { class: "artist-show-role" }, roleText) : null
      )
    ));
  });
  modalBody.appendChild(list);

  openModal();
}

/**
 * Open a modal showing insights for a given artist. The modal is decorated
 * with an "artist insights" eyebrow so it's visually distinct from concert
 * and poster modals.
 */
function openArtistInsightsModal(artistName) {
  const shows = concertsFeaturingArtist(artistName);
  if (shows.length === 0) return;

  // Mark modal state but DON'T set deep-link nav — this modal isn't part of
  // the concert/poster nav lists, and arrow keys here don't have a defined
  // "next" item.
  MODAL_STATE.kind = "artist";
  MODAL_STATE.id = artistName;
  MODAL_STATE.list = null;
  MODAL_STATE.index = -1;

  modalBody.innerHTML = "";

  // Eyebrow distinguishes from concert/poster modals
  modalBody.appendChild(el("div", { class: "modal-eyebrow artist-eyebrow" }, "BAND INSIGHTS"));
  modalBody.appendChild(el("h2", { class: "modal-title" }, artistName));

  // Subtitle: total count + year span
  const yearSet = new Set(shows.map(c => c.year).filter(Boolean));
  const earliestYear = Math.min(...yearSet);
  const latestYear = Math.max(...yearSet);
  const headlinerCount = shows.filter(c => {
    const targetKey = normalizeArtistKey(artistName);
    return normalizeArtistKey(c.artist) === targetKey && !c.festivalKey;
  }).length;
  const openerCount = shows.length - headlinerCount;

  const subtitleParts = [
    `${shows.length} show${shows.length === 1 ? "" : "s"}`,
    yearSet.size === 1
      ? `in ${earliestYear}`
      : `from ${earliestYear} to ${latestYear}`,
  ];
  modalBody.appendChild(el("div", { class: "modal-meta" }, subtitleParts.join(" ")));

  // Role breakdown line
  const roleParts = [];
  if (headlinerCount > 0) roleParts.push(`${headlinerCount} as headliner`);
  if (openerCount > 0) roleParts.push(`${openerCount} as opener / festival lineup`);
  if (roleParts.length > 0) {
    modalBody.appendChild(el("div", { class: "artist-role-breakdown" }, roleParts.join(" · ")));
  }

  // Year strip: one cell per year, intensity = show count that year.
  // Compact horizontal layout, only showing years that actually had shows.
  // For sparse data this reads cleaner than a full grid.
  const yearCounts = {};
  shows.forEach(c => {
    if (c.year) yearCounts[c.year] = (yearCounts[c.year] || 0) + 1;
  });
  const allUserYears = (() => {
    if (STATE.concerts.length === 0) return [];
    const years = STATE.concerts.map(c => c.year).filter(Boolean);
    return [...new Set(years)].sort();
  })();
  const maxArtistYearCount = Math.max(...Object.values(yearCounts));

  modalBody.appendChild(el("h4", { class: "artist-section-h" }, "Years you saw them"));
  const stripDesc = el("p", { class: "artist-strip-desc" },
    "Each cell is one year of your concert history. Filled cells = you saw them that year.");
  modalBody.appendChild(stripDesc);

  const strip = el("div", { class: "artist-year-strip" });
  allUserYears.forEach(y => {
    const count = yearCounts[y] || 0;
    const intensity = count === 0 ? 0 : Math.max(0.35, count / maxArtistYearCount);
    const cell = el("div", {
      class: "artist-year-cell" + (count > 0 ? " has-shows" : ""),
      style: count > 0 ? `--intensity:${intensity};` : "",
      title: count > 0
        ? `${y}: ${count} show${count === 1 ? "" : "s"}`
        : `${y}: did not see them`,
    },
      el("span", { class: "artist-year-cell-year" }, String(y)),
      count > 0 ? el("span", { class: "artist-year-cell-count" }, String(count)) : null
    );
    strip.appendChild(cell);
  });
  modalBody.appendChild(strip);

  // Show list
  modalBody.appendChild(el("h4", { class: "artist-section-h" }, "The shows"));
  const list = el("div", { class: "artist-show-list" });
  shows.forEach(c => {
    const role = (() => {
      const targetKey = normalizeArtistKey(artistName);
      if (normalizeArtistKey(c.artist) === targetKey && !c.festivalKey) {
        return "headliner";
      }
      if (c.festivalKey) return "festival";
      return "opener";
    })();
    const venueText = [c.venue, c.city, c.state].filter(Boolean).join(", ");
    const item = el("div", {
      class: "artist-show-item",
      on: { click: () => {
        // Open the underlying concert modal. Closing the artist modal first
        // and then opening the concert modal keeps the modal-state pointer clean.
        closeModal();
        // Defer slightly so the previous modal's cleanup completes
        setTimeout(() => openConcertModal(c), 50);
      }}
    },
      el("div", { class: "artist-show-date" }, formatDate(c.date)),
      el("div", { class: "artist-show-meta" },
        el("span", { class: "artist-show-venue" }, venueText || "Unknown venue"),
        role === "headliner"
          ? null
          : el("span", { class: "artist-show-role" + (role === "festival" ? " festival" : "") },
              role === "festival" ? c.artist || "festival" : `opening for ${c.artist || "unknown"}`)
      )
    );
    list.appendChild(item);
  });
  modalBody.appendChild(list);

  // Link to Timeline filter
  const links = el("div", { class: "modal-links" });
  links.appendChild(el("a", {
    class: "m-link",
    href: "#/timeline?artist=" + encodeURIComponent(artistName),
    on: { click: () => closeModal() }  // close modal so navigation feels clean
  }, "View on Timeline"));
  modalBody.appendChild(links);

  openModal();
}

/**
 * Open the modal for a concert. Optional `navContext` wires arrow-key
 * navigation through a list of sibling concerts.
 *
 * @param {object} c - the concert record
 * @param {object} [navContext] - { list, index } for prev/next navigation
 */
function openConcertModal(c, navContext) {
  // Record state for keyboard nav and deep-linking
  MODAL_STATE.kind = "concert";
  MODAL_STATE.id = c.id;
  if (navContext && Array.isArray(navContext.list)) {
    MODAL_STATE.list = navContext.list;
    MODAL_STATE.index = navContext.index;
  } else {
    MODAL_STATE.list = null;
    MODAL_STATE.index = -1;
  }
  setModalDeepLink("concert", c.id);

  // Match posters to this concert.
  //
  // The previous logic used artist name fuzzy-matching, which fails for two
  // important real-world cases:
  //   1. Tour-named concerts: a "Sessanta" show actually featured Maynard's
  //      three projects (Tool, Puscifer, APC) — there's a Puscifer-branded
  //      poster from that show that doesn't share the artist name.
  //   2. Festival days: festival concert rows are named "Sonic Temple
  //      Festival" but the day's lineup includes Tool, Slipknot, etc., each
  //      of which may have its own band-specific poster.
  //
  // Per user direction, we now match by DATE primarily — any poster from the
  // same date as the concert is shown in that concert's modal. We keep a
  // small fuzzy-date window (±4 days) for non-festival concerts only, to
  // catch posters dated slightly off from the show date (rare, but real:
  // some posters carry the printing/release date rather than the show date).
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

  // For festival concerts, gather all dates the festival covered (across all
  // its days, regardless of which the user attended). This lets a festival
  // modal include band-specific posters from any day of the festival, plus
  // the festival-wide poster which may be dated to the festival's first day.
  // Example: Rock on the Range 2018 spans May 18-20. A modal for Day 3
  // (May 20) should include the festival poster (May 18) and the Tool
  // poster (May 20) — they're all part of the same event.
  let festivalDateSet = null;
  if (c.festivalKey) {
    festivalDateSet = new Set(
      STATE.concerts
        .filter(ct => ct.festivalKey === c.festivalKey && ct.date)
        .map(ct => ct.date)
    );
    // Also include any poster dated within ±2 days of the earliest/latest
    // festival concert. This handles cases where the user only attended one
    // day of a multi-day festival but owns the festival-wide poster, which
    // may be dated to a non-attended day. We only extend for posters tagged
    // tourShowSpecific="Festival" — band-specific posters from non-attended
    // days don't belong here.
  }

  const shows = STATE.posters.filter(p => {
    // Exact date match always counts (most common case)
    if (p.date === c.date) return true;

    // Festival concert: include posters from any day of the festival,
    // and festival-tagged posters dated near the festival's range.
    if (c.festivalKey && festivalDateSet) {
      // Direct match on a sibling festival day
      if (festivalDateSet.has(p.date)) return true;
      // Festival-tagged poster (e.g. festival-wide poster dated to a day the
      // user didn't attend, like Welcome to Rockville 2023 where the poster
      // is dated to the festival's opening day but the user attended later).
      const isFestivalPoster = (p.tourShowSpecific || "").toLowerCase() === "festival";
      if (isFestivalPoster) {
        // Check date proximity to the festival's overall range (±3 days
        // beyond the festival's outermost attended day).
        const festDates = [...festivalDateSet].sort();
        const earliest = festDates[0];
        const latest = festDates[festDates.length - 1];
        if (dateDiffDays(p.date, earliest) <= 3 || dateDiffDays(p.date, latest) <= 3) {
          return true;
        }
      }
      // Otherwise festival concerts don't fuzzy-match on artist
      return false;
    }

    // Non-festival concerts: ±4 day fuzzy match if artist also matches.
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
  // Special case for tour: render as a clickable link that filters Timeline
  // to all shows on that tour (exact-name match).
  const facts = el("div", { class: "modal-facts" });
  const factList = [
    c.tourName && !c.festivalKey && ["Tour", c.tourName, "tour"],
    c.openingActs && !c.festivalKey && ["Opening acts", c.openingActs, null],
    c.attendedWith && ["Attended with", c.attendedWith, null],
  ].filter(Boolean);
  factList.forEach(([label, val, kind]) => {
    let valueNode;
    if (kind === "tour") {
      // Clickable tour name → filter timeline
      valueNode = el("a", {
        class: "fact-value tour-link",
        href: "#/timeline?tour=" + encodeURIComponent(val),
        title: `See all shows on the "${val}" tour`,
      }, val);
    } else {
      valueNode = el("div", { class: "fact-value" }, val);
    }
    facts.appendChild(el("div", { class: "fact" },
      el("div", { class: "fact-label" }, label),
      valueNode
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

  // Opener setlists — pulled by artist+date search during prefetch.
  // For festivals, only the top 5 acts are fetched (per prefetch config).
  // Renders a smaller block per opener with the band name as the header.
  const openerActs = splitActs(c.openingActs);
  const actsToCheck = c.festivalKey ? openerActs.slice(0, 5) : openerActs;
  const openerSetlists = [];
  actsToCheck.forEach(actName => {
    const sl = openerSetlistFor(actName, c.date);
    if (sl && sl.sets && sl.sets.length) openerSetlists.push({ name: actName, setlist: sl });
  });
  openerSetlists.forEach(({ name, setlist: sl }) => {
    modalBody.appendChild(renderSetlistBlock(sl, { subtitle: `${name} · opener` }));
  });

  // Action links
  const links = el("div", { class: "modal-links" });
  if (c.setlistLink && c.setlistLink.startsWith("http")) {
    links.appendChild(el("a", { class: "m-link accent-link", href: c.setlistLink, target: "_blank", rel: "noopener" }, "Setlist.fm ↗"));
  }
  if (c.venue && !c.festivalKey) {
    links.appendChild(el("a", { class: "m-link", href: "#/timeline?venue=" + encodeURIComponent(c.venue) },
      "More at " + c.venue));
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
/**
 * Open the poster modal for a group (all poster variants for a given show).
 * Optional `navContext` wires arrow-key navigation through sibling groups.
 *
 * Group identity is determined by the primary poster's id — that's what the
 * deep-link URL records, and what we match against when a shared URL loads.
 */
function openPosterModal(group, navContext) {
  const primaryPosterId = group.posters[0] ? group.posters[0].id : null;

  MODAL_STATE.kind = "poster";
  MODAL_STATE.id = primaryPosterId;
  if (navContext && Array.isArray(navContext.list)) {
    MODAL_STATE.list = navContext.list;
    MODAL_STATE.index = navContext.index;
  } else {
    MODAL_STATE.list = null;
    MODAL_STATE.index = -1;
  }
  if (primaryPosterId !== null) setModalDeepLink("poster", primaryPosterId);

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
  const wrap = el("div", { class: "variant has-dual-images" });

  // Images section: show stock (reference image) and personal (user's photo)
  // side-by-side. Each holder handles its own fallback chain and renders a
  // "No photo yet" placeholder + "Paste URL" button if nothing loads. Both
  // images are clickable → lightbox.
  const imageCol = el("div", { class: "variant-images dual" });

  /**
   * Build a labeled image holder for one "kind" of poster photo.
   * Tries a short fallback chain (CSV/override URL → local file), and if
   * every attempt fails, renders the "No photo yet" placeholder.
   */
  function buildImageHolder(which) {
    const holder = el("div", { class: "variant-image-holder" });
    holder.appendChild(el("div", { class: "variant-image-label" },
      which === "stock" ? "Stock image" : "My photo"));
    const inner = el("div", { class: "variant-image" });

    const primarySrc = posterImageSrc(p, which);
    const fallbackFile = `images/${which}/poster-${p.id}.jpg`;
    const img = el("img", {
      src: primarySrc,
      alt: `${p.artist} ${which} poster`,
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
          // Walk a short chain: primary src → local file → give up
          if (!this.dataset.triedLocal && this.src !== fallbackFile) {
            this.dataset.triedLocal = "1";
            this.src = fallbackFile;
            return;
          }
          this.dataset.broken = "1";
          inner.innerHTML = "";
          const hint = which === "stock"
            ? `No stock image yet.<br>Add to <code>data/poster_images.csv</code>,<br>drop <code>images/stock/poster-${p.id}.jpg</code>,<br>or paste a URL below.`
            : `No personal photo yet.<br>Add to <code>data/poster_images.csv</code>,<br>drop <code>images/personal/poster-${p.id}.jpg</code>,<br>or paste a URL below.`;
          inner.appendChild(el("div", { class: "no-img", html: hint }));
          inner.appendChild(el("button", {
            class: "v-link",
            style: "margin-top:8px;background:transparent;cursor:pointer;",
            on: { click: () => {
              // Re-run the build on success so the paste is reflected immediately
              promptForImageUrl(p, which, () => {
                holder.replaceWith(buildImageHolder(which));
              });
            }}
          }, "Paste URL"));
        }
      }
    });
    img.classList.add("clickable-poster");
    inner.appendChild(img);
    holder.appendChild(inner);
    return holder;
  }

  imageCol.appendChild(buildImageHolder("stock"));
  imageCol.appendChild(buildImageHolder("personal"));
  wrap.appendChild(imageCol);

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
  const labels = { stock: "STOCK IMAGE", personal: "MY PHOTO", official: "OFFICIAL" };
  const label = labels[which] || which.toUpperCase();
  const url = prompt(
    `Paste an image URL for the ${label} view of this poster.\n\n` +
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
