/* ============================================================
   Seth's Concert Journey — app logic
   Vanilla JS, hash-based router, loads JSON data locally.
   ============================================================ */

const STATE = {
  concerts: [],
  posters: [],
  // poster_id -> { personal_url, official_url }
  posterImages: {},
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
  // inverse lookup built in init
  stateCodes: {},
  // user-editable metadata for posters (stored in localStorage, merged on load)
  // { posterId: { officialImage: url, personalImage: url } }
  posterOverrides: loadOverrides(),
};

function loadOverrides() {
  try {
    const raw = localStorage.getItem("posterOverrides");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveOverrides() {
  try { localStorage.setItem("posterOverrides", JSON.stringify(STATE.posterOverrides)); } catch {}
}

/* ============================================================
   DATA LOADING
   ============================================================ */
async function loadData() {
  const [c, p, csvText] = await Promise.all([
    fetch("data/concerts.json").then(r => r.json()),
    fetch("data/posters.json").then(r => r.json()),
    fetch("data/poster_images.csv").then(r => r.ok ? r.text() : "").catch(() => ""),
  ]);
  STATE.concerts = c;
  STATE.posters = p;
  STATE.posterImages = parsePosterImagesCSV(csvText);
  // build state code lookups
  Object.entries(STATE.stateNames).forEach(([code, name]) => {
    STATE.stateCodes[name.toLowerCase()] = code;
  });

  const past = c.filter(x => new Date(x.date) <= new Date()).length;
  const future = c.length - past;
  document.getElementById("brand-sub").textContent =
    `${past} shows attended · ${future} upcoming · ${p.length} posters`;
}

/**
 * Parse poster_images.csv.
 * Simple CSV parser: handles quoted fields containing commas.
 * Columns: poster_id, date, artist, personal_url, official_url
 */
function parsePosterImagesCSV(text) {
  const out = {};
  if (!text) return out;
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return out;
  const header = splitCsvLine(lines[0]);
  const idx = {
    id: header.indexOf("poster_id"),
    personal: header.indexOf("personal_url"),
    official: header.indexOf("official_url"),
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
  // strip query
  const [path] = hash.split("?");
  const fn = ROUTES[path] || renderTimeline;
  // highlight nav
  document.querySelectorAll(".main-nav a").forEach(a => {
    a.classList.toggle("active", a.getAttribute("href") === path);
  });
  window.scrollTo({ top: 0, behavior: "instant" });
  fn();
}

/* ============================================================
   HELPERS
   ============================================================ */
function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatShortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
function safe(v, fallback = "—") {
  return v == null || v === "" ? fallback : v;
}
function classifyType(t) {
  if (!t) return "";
  const s = t.toLowerCase();
  if (s.includes("foil")) return "Foil";
  if (s.includes("vip")) return "VIP";
  if (s.includes("ap")) return "AP";
  return "SE";
}

/* ============================================================
   TIMELINE VIEW
   ============================================================ */
function renderTimeline() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  // Filter state in URL
  const params = new URLSearchParams((location.hash.split("?")[1] || ""));
  const q = params.get("q") || "";
  const state = params.get("state") || "";
  const artist = params.get("artist") || "";
  const showFuture = params.get("future") !== "0";
  const posterOnly = params.get("posterOnly") === "1";

  const header = el("div", { class: "view-header" },
    el("h2", { class: "view-title" }, "A ", el("span", { class: "accent" }, "lifetime"), " of live music"),
    el("p", { class: "view-sub" }, "Chronological. Newest on top.")
  );
  app.appendChild(header);

  // Build filter bar
  const allStates = [...new Set(STATE.concerts.map(c => c.state).filter(Boolean))].sort();
  const allArtists = [...new Set(STATE.concerts.map(c => c.artist).filter(Boolean))].sort();

  const filterBar = el("div", { class: "filter-bar" });

  const searchInput = el("input", {
    type: "text", placeholder: "Search artist, venue, city, tour…", value: q,
    on: { input: e => updateParam("q", e.target.value) }
  });
  filterBar.appendChild(searchInput);

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

  const posterChip = el("button", {
    class: "chip" + (posterOnly ? " active" : ""),
    on: { click: () => updateParam("posterOnly", posterOnly ? "0" : "1") }
  }, "With poster");
  filterBar.appendChild(posterChip);

  const futureChip = el("button", {
    class: "chip" + (showFuture ? " active" : ""),
    on: { click: () => updateParam("future", showFuture ? "0" : "1") }
  }, "Show upcoming");
  filterBar.appendChild(futureChip);

  const countEl = el("div", { class: "filter-count" });
  filterBar.appendChild(countEl);

  app.appendChild(filterBar);

  // Filter + sort
  const qLower = q.toLowerCase();
  let filtered = STATE.concerts.filter(c => {
    if (state && c.state !== state) return false;
    if (artist && c.artist !== artist) return false;
    if (posterOnly && !c.hasPoster) return false;
    if (!showFuture && isFuture(c.date)) return false;
    if (qLower) {
      const hay = [c.artist, c.venue, c.city, c.tourName, c.openingActs, c.notes, c.attendedWith]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  // Sort: newest first, but future shows at top in forward order
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  countEl.textContent = `${filtered.length} show${filtered.length === 1 ? "" : "s"}`;

  if (filtered.length === 0) {
    app.appendChild(el("div", { class: "loading" }, "No shows match these filters."));
    return;
  }

  // Group by year
  const byYear = {};
  filtered.forEach(c => {
    (byYear[c.year] = byYear[c.year] || []).push(c);
  });
  const years = Object.keys(byYear).sort((a, b) => b - a);

  const timeline = el("div", { class: "timeline" });
  years.forEach(year => {
    const block = el("div", { class: "year-block" });
    const hasFuture = byYear[year].some(c => isFuture(c.date));
    block.appendChild(el("div", { class: "year-label" }, year));
    block.appendChild(el("div", { class: "year-meta" },
      `${byYear[year].length} show${byYear[year].length === 1 ? "" : "s"}` +
      (hasFuture ? " · includes upcoming" : "")));

    const grid = el("div", { class: "concert-grid" });
    byYear[year].forEach(c => grid.appendChild(concertCard(c)));
    block.appendChild(grid);
    timeline.appendChild(block);
  });
  app.appendChild(timeline);
}

function concertCard(c) {
  const classes = ["concert-card"];
  if (c.hasPoster) classes.push("has-poster");
  if (isFuture(c.date)) classes.push("future");
  return el("div", {
    class: classes.join(" "),
    on: { click: () => openConcertModal(c) }
  },
    el("div", { class: "cc-date" }, formatDate(c.date), c.dayOfWeek ? " · " + c.dayOfWeek : ""),
    el("h3", { class: "cc-artist" }, c.artist || "Unknown"),
    el("p", { class: "cc-venue" }, c.venue || ""),
    el("div", { class: "cc-location" }, [c.city, c.state].filter(Boolean).join(", ")),
    c.tourName && c.tourName !== "—" ? el("div", { class: "cc-tour" }, c.tourName) : null
  );
}

function updateParam(key, value) {
  const [path, qs] = (location.hash || "#/timeline").split("?");
  const params = new URLSearchParams(qs || "");
  if (!value || value === "") params.delete(key);
  else params.set(key, value);
  const newHash = path + (params.toString() ? "?" + params.toString() : "");
  location.hash = newHash;
}

/* ============================================================
   MAP VIEW (US states + venue dots)
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

  const header = el("div", { class: "view-header" },
    el("h2", { class: "view-title" }, "The ", el("span", { class: "accent" }, "road"), " so far"),
    el("p", { class: "view-sub" }, "States visited. Venues pinned. Click for details.")
  );
  app.appendChild(header);

  // Exclude future
  const past = STATE.concerts.filter(c => !isFuture(c.date));
  const stateCount = {};
  past.forEach(c => { if (c.state) stateCount[c.state] = (stateCount[c.state] || 0) + 1; });

  // Legend
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

  // State counts list
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

  // Tooltip
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
    // State name -> code lookup
    const nameToCode = STATE.stateCodes;

    d3svg.append("g").selectAll("path")
      .data(states.features)
      .enter()
      .append("path")
      .attr("class", f => {
        const code = nameToCode[(f.properties.name || "").toLowerCase()];
        return "state" + (code && stateCount[code] ? " visited" : "");
      })
      .attr("d", path)
      .attr("data-name", f => f.properties.name)
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

    // Venue dots: we don't have lat/lon in spreadsheet, so approximate by city centroids
    // Use a small lookup for cities present in user's data
    const venueDots = aggregateVenues(past);
    const cityLookup = CITY_COORDS;

    const dotLayer = d3svg.append("g");
    venueDots.forEach(v => {
      const key = `${v.city.toLowerCase()},${(v.state || "").toLowerCase()}`;
      const ll = cityLookup[key];
      if (!ll) return;
      const [x, y] = projection([ll[1], ll[0]]) || [null, null];
      if (x == null) return;
      const r = Math.max(4, Math.min(12, 3 + Math.sqrt(v.count) * 2));
      dotLayer.append("circle")
        .attr("class", "venue")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", r)
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
    wrap.appendChild(el("div", { class: "loading" }, "Couldn't load US map (no internet?). State list still works below."));
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

  const header = el("div", { class: "view-header" },
    el("h2", { class: "view-title" }, "Paper ", el("span", { class: "accent" }, "artifacts")),
    el("p", { class: "view-sub" }, "Variants of the same show are grouped together.")
  );
  app.appendChild(header);

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
    variants: list.sort((a, b) => (a.type || "").localeCompare(b.type || "")),
  }));

  // Filters
  const allArtists = [...new Set(groupList.map(g => g.artist).filter(Boolean))].sort();
  const allTypes = [...new Set(STATE.posters.map(p => classifyType(p.type)).filter(Boolean))].sort();

  const filterBar = el("div", { class: "filter-bar" });
  filterBar.appendChild(el("input", {
    type: "text", placeholder: "Search artist, illustrator…", value: q,
    on: { input: e => updateParam("q", e.target.value) }
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

  const countEl = el("div", { class: "filter-count" });
  filterBar.appendChild(countEl);
  app.appendChild(filterBar);

  // Apply filters to GROUPS
  const qLower = q.toLowerCase();
  const filtered = groupList.filter(g => {
    if (artist && g.artist !== artist) return false;
    if (type) {
      if (!g.variants.some(v => classifyType(v.type) === type)) return false;
    }
    if (autographed) {
      if (!g.variants.some(v => v.autographed)) return false;
    }
    if (qLower) {
      const hay = [g.artist, g.location, ...g.variants.map(v => v.illustrator)]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(qLower)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => b.date.localeCompare(a.date));
  countEl.textContent = `${filtered.length} show${filtered.length === 1 ? "" : "s"} · ${filtered.reduce((s, g) => s + g.variants.length, 0)} variants`;

  if (filtered.length === 0) {
    app.appendChild(el("div", { class: "loading" }, "No posters match these filters."));
    return;
  }

  const grid = el("div", { class: "poster-grid" });
  filtered.forEach(g => grid.appendChild(posterGroupCard(g)));
  app.appendChild(grid);
}

function posterImageSrc(p, which = "personal") {
  // Priority order:
  //   1. localStorage override (user pasted a URL in the modal)
  //   2. URL from data/poster_images.csv (the Drive thumbnail, etc.)
  //   3. Local file: images/personal/poster-<id>.jpg or images/official/poster-<id>.jpg
  const override = STATE.posterOverrides[p.id] || {};
  if (which === "personal" && override.personalImage) return override.personalImage;
  if (which === "official" && override.officialImage) return override.officialImage;

  const csv = STATE.posterImages[p.id] || {};
  if (which === "personal" && csv.personal_url) return csv.personal_url;
  if (which === "official" && csv.official_url) return csv.official_url;

  const base = which === "personal" ? "images/personal/" : "images/official/";
  return base + `poster-${p.id}.jpg`;
}

function posterGroupCard(g) {
  // use first variant for thumb preference
  const primary = g.variants[0];
  const thumb = el("div", { class: "poster-thumb" });

  // Thumbnail fallback chain:
  //   1. Personal URL (CSV / localStorage)
  //   2. Official URL (CSV / localStorage)
  //   3. images/personal/poster-<id>.jpg
  //   4. images/official/poster-<id>.jpg
  //   5. Placeholder
  const tries = [
    { src: posterImageSrc(primary, "personal"), label: "personal-url" },
    { src: posterImageSrc(primary, "official"), label: "official-url" },
    { src: `images/personal/poster-${primary.id}.jpg`, label: "personal-file" },
    { src: `images/official/poster-${primary.id}.jpg`, label: "official-file" },
  ];
  // De-dupe: if posterImageSrc already returned the local file path, we might
  // double-try. Cheap workaround: skip exact-string duplicates.
  const seen = new Set();
  const uniqueTries = tries.filter(t => {
    if (!t.src || seen.has(t.src)) return false;
    seen.add(t.src);
    return true;
  });

  let attempt = 0;
  const img = el("img", {
    src: uniqueTries[0] ? uniqueTries[0].src : "",
    alt: `${g.artist} poster`,
    loading: "lazy",
    on: {
      error: function() {
        attempt++;
        if (attempt < uniqueTries.length) {
          this.src = uniqueTries[attempt].src;
        } else {
          this.remove();
          thumb.appendChild(el("div", { class: "placeholder" }, "♪"));
        }
      }
    }
  });
  thumb.appendChild(img);

  if (g.variants.length > 1) {
    thumb.appendChild(el("div", { class: "variant-count" }, `${g.variants.length} variants`));
  }

  const typesWrap = el("div", { class: "pi-types" });
  [...new Set(g.variants.map(v => classifyType(v.type)))].forEach(t => {
    if (t) typesWrap.appendChild(el("span", { class: `type-badge ${t}` }, t));
  });

  const info = el("div", { class: "poster-info" },
    el("div", { class: "pi-date" }, formatDate(g.date)),
    el("h3", { class: "pi-artist" }, g.artist || "Unknown"),
    el("p", { class: "pi-loc" }, g.location || ""),
    typesWrap
  );

  return el("div", {
    class: "poster-group",
    on: { click: () => openPosterModal(g) }
  }, thumb, info);
}

/* ============================================================
   STATS VIEW
   ============================================================ */
function renderStats() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  const header = el("div", { class: "view-header" },
    el("h2", { class: "view-title" }, "The ", el("span", { class: "accent" }, "numbers")),
    el("p", { class: "view-sub" }, "By the tally.")
  );
  app.appendChild(header);

  const past = STATE.concerts.filter(c => !isFuture(c.date));
  const future = STATE.concerts.filter(c => isFuture(c.date));

  const uniqueArtists = new Set(past.map(c => c.artist).filter(Boolean));
  const uniqueVenues = new Set(past.map(c => c.venue).filter(Boolean));
  const uniqueStates = new Set(past.map(c => c.state).filter(Boolean));
  const uniqueCities = new Set(past.map(c => c.city).filter(Boolean));
  const firstYear = Math.min(...past.map(c => c.year));
  const lastYear = Math.max(...past.map(c => c.year));

  const grid = el("div", { class: "stats-grid" });
  [
    { label: "Shows attended", value: past.length, unit: "concerts logged" },
    { label: "Upcoming", value: future.length, unit: "already booked" },
    { label: "Unique artists", value: uniqueArtists.size },
    { label: "Unique venues", value: uniqueVenues.size },
    { label: "States visited", value: uniqueStates.size, unit: "of 50 + DC" },
    { label: "Posters", value: STATE.posters.length, unit: "variants collected" },
    { label: "Autographed", value: STATE.posters.filter(p => p.autographed).length },
    { label: "Years of live music", value: (lastYear - firstYear + 1), unit: `${firstYear} – ${lastYear}` },
  ].forEach(s => {
    grid.appendChild(el("div", { class: "stat-card" },
      el("p", { class: "stat-label" }, s.label),
      el("p", { class: "stat-value" }, String(s.value)),
      s.unit ? el("p", { class: "stat-unit" }, s.unit) : null
    ));
  });
  app.appendChild(grid);

  // Top artists (past only)
  const artistCount = {};
  past.forEach(c => { if (c.artist) artistCount[c.artist] = (artistCount[c.artist] || 0) + 1; });
  const topArtists = Object.entries(artistCount)
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

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

  // Top venues
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

  // Year chart (past + future, but label future)
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
      on: { click: () => {
        // No direct year filter, but can filter via search? Skip for now.
      }}
    },
      el("span", { class: "bar-count" }, String(count)),
      el("span", { class: "bar-year" }, y)
    );
    if (parseInt(y) > new Date().getFullYear()) {
      bar.style.background = "var(--accent-3)";
    }
    bars.appendChild(bar);
  });
  yearChart.appendChild(bars);
  app.appendChild(yearChart);
}

/* ============================================================
   MODAL
   ============================================================ */
const modal = document.getElementById("modal");
const modalBody = modal.querySelector(".modal-body");
modal.querySelector(".modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", e => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});
function openModal() {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}
function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = "";
}

function openConcertModal(c) {
  // find posters for this show (fuzzy match: same date ± a few days, loose artist match)
  const normalizeArtist = s => (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // drop apostrophes, spaces, &, slashes
    .replace(/and/g, "");
  const dateDiffDays = (a, b) => Math.abs(
    (new Date(a + "T00:00:00") - new Date(b + "T00:00:00")) / 86400000
  );
  // Small edit-distance check for near-miss typos (e.g. AVTT vs AVVT)
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
    // loose artist match: either side contains the other, OR very close typo
    return pArtist.includes(cArtist) || cArtist.includes(pArtist)
        || editDist(pArtist, cArtist) <= 2;
  });

  modalBody.innerHTML = "";
  modalBody.appendChild(el("div", { class: "modal-eyebrow" },
    formatDate(c.date) + (c.dayOfWeek ? " · " + c.dayOfWeek : "") +
    (isFuture(c.date) ? " · UPCOMING" : "")
  ));
  modalBody.appendChild(el("h2", { class: "modal-title" }, c.artist || "Unknown"));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    [c.venue, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")
  ));

  const facts = el("div", { class: "modal-facts" });
  const factList = [
    c.tourName && ["Tour", c.tourName],
    c.openingActs && ["Opening acts", c.openingActs],
    c.attendedWith && ["Attended with", c.attendedWith],
    c.notes && ["Notes", c.notes],
  ].filter(Boolean);
  factList.forEach(([label, val]) => {
    facts.appendChild(el("div", { class: "fact" },
      el("div", { class: "fact-label" }, label),
      el("div", { class: "fact-value" }, val)
    ));
  });
  if (factList.length) modalBody.appendChild(facts);

  if (shows.length) {
    modalBody.appendChild(el("div", { class: "poster-variants" },
      el("h4", {}, shows.length > 1 ? `${shows.length} poster variants from this show` : "Poster from this show"),
      el("div", { class: "variant-list" }, ...shows.map(variantBlock))
    ));
  }

  const links = el("div", { class: "modal-links" });
  if (c.setlistLink && c.setlistLink !== "Setlist Link") {
    links.appendChild(el("a", { class: "m-link", href: c.setlistLink, target: "_blank", rel: "noopener" }, "Setlist ↗"));
  }
  if (c.state) {
    links.appendChild(el("a", { class: "m-link", href: "#/timeline?state=" + encodeURIComponent(c.state) },
      "More from " + (STATE.stateNames[c.state] || c.state)));
  }
  if (c.artist) {
    links.appendChild(el("a", { class: "m-link", href: "#/timeline?artist=" + encodeURIComponent(c.artist) },
      "More " + c.artist));
  }
  if (links.children.length) modalBody.appendChild(links);

  openModal();
}

function openPosterModal(group) {
  modalBody.innerHTML = "";
  modalBody.appendChild(el("div", { class: "modal-eyebrow" }, formatDate(group.date)));
  modalBody.appendChild(el("h2", { class: "modal-title" }, group.artist || "Unknown"));
  modalBody.appendChild(el("div", { class: "modal-meta" },
    group.location + (group.attended ? "" : " · Not attended")
  ));

  modalBody.appendChild(el("div", { class: "poster-variants" },
    el("h4", {}, group.variants.length > 1
      ? `${group.variants.length} variants of this show's poster`
      : "The poster"),
    el("div", { class: "variant-list" }, ...group.variants.map(variantBlock))
  ));

  // Find the matching concert for context (fuzzy match)
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
  const gArtist = normalizeArtist(group.artist);
  const c = STATE.concerts.find(x => {
    if (dateDiffDays(x.date, group.date) > 4) return false;
    const xArtist = normalizeArtist(x.artist);
    if (!xArtist || !gArtist) return false;
    return xArtist.includes(gArtist) || gArtist.includes(xArtist)
        || editDist(xArtist, gArtist) <= 2;
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

  // Images section — tabbed between "MINE" and "OFFICIAL"
  const imageCol = el("div", { class: "variant-images" });
  const tabRow = el("div", { class: "variant-tab-row" });
  const imgHolder = el("div", { class: "variant-image" });

  let currentView = "personal";

  function showImage(which) {
    currentView = which;
    imgHolder.innerHTML = "";

    // Fallback chain:
    //   1. posterImageSrc() — localStorage override, then CSV URL
    //   2. Local file: images/{personal|official}/poster-<id>.jpg
    //   3. Placeholder + Paste-URL button
    const primarySrc = posterImageSrc(p, which);
    const fallbackFile = `images/${which === "personal" ? "personal" : "official"}/poster-${p.id}.jpg`;
    const img = el("img", {
      src: primarySrc,
      alt: `${p.artist} poster — ${which}`,
      loading: "lazy",
      on: {
        error: function() {
          // If we haven't tried the local file yet, try that
          if (this.src !== window.location.origin + "/" + fallbackFile
              && !this.dataset.triedLocal) {
            this.dataset.triedLocal = "1";
            this.src = fallbackFile;
            return;
          }
          // Both failed — show placeholder with paste-URL option
          imgHolder.innerHTML = "";
          const hint = which === "personal"
            ? `No photo yet.<br>Add one to <code>data/poster_images.csv</code>,<br>drop a file at <code>images/personal/poster-${p.id}.jpg</code>,<br>or paste a URL below.`
            : `No official image yet.<br>Add one to <code>data/poster_images.csv</code>,<br>drop a file at <code>images/official/poster-${p.id}.jpg</code>,<br>or paste a URL below.`;
          const msg = el("div", { class: "no-img", html: hint });
          imgHolder.appendChild(msg);

          const urlBtn = el("button", {
            class: "v-link",
            style: "margin-top:8px;background:transparent;cursor:pointer;",
            on: { click: () => promptForImageUrl(p, which, () => showImage(which)) }
          }, "Paste URL");
          imgHolder.appendChild(urlBtn);
        }
      }
    });
    imgHolder.appendChild(img);
    // update active tabs
    tabRow.querySelectorAll(".variant-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.which === which);
    });
  }

  tabRow.appendChild(el("button", {
    class: "variant-tab active", "data-which": "personal",
    on: { click: () => showImage("personal") }
  }, "Mine"));
  tabRow.appendChild(el("button", {
    class: "variant-tab", "data-which": "official",
    on: { click: () => showImage("official") }
  }, "Official"));

  imageCol.appendChild(tabRow);
  imageCol.appendChild(imgHolder);
  wrap.appendChild(imageCol);
  // initial render
  setTimeout(() => showImage("personal"), 0);

  // Info
  const info = el("div", { class: "variant-info" });
  info.appendChild(el("div", { class: "v-type" },
    (p.type || "Poster"),
    typeClass ? el("span", { class: `type-badge ${typeClass}`, style: "margin-left:10px;vertical-align:middle;" }, typeClass) : null
  ));
  if (p.illustrator) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Artist: "), p.illustrator));
  if (p.number) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Edition: "), p.number));
  if (p.tourShowSpecific) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Type: "), p.tourShowSpecific));
  const flags = [];
  if (p.autographed) flags.push("Autographed");
  if (p.framed) flags.push("Framed");
  if (!p.attended) flags.push("Not attended");
  if (flags.length) info.appendChild(el("div", { class: "v-row" }, el("strong", {}, "Flags: "), flags.join(" · ")));

  const vlinks = el("div", { class: "v-links" });
  if (p.expressobeansLink) {
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
