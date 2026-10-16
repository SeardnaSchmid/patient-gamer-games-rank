// Builds games.json from public data. Run: node scripts/fetch.mjs
//
// Candidates   SteamSpy: every Steam game with >= MIN_REVIEWS reviews and
//              >= MIN_PCT % positive (also gives reviews and Steam price).
// Fixed values Fetched once per game and kept (refreshed after REFRESH_DAYS):
//              Steam store (release, Metascore, features), Steam Deck rating,
//              SteamSpy user tags (genres like "Metroidvania", not Steam's coarse ones),
//              HowLongToBeat main-story hours (unofficial site API, may break).
//              At most LIMIT games get these per run, so the catalogue fills
//              up over several runs instead of hammering the APIs.
// Prices       CheapShark, 25 games per request, every run: best current price
//              across stores and the all-time low.
// A lookup that fails keeps the game's previous value. Progress is saved every
// 50 games, so the script can be stopped and restarted.
// Env: LIMIT, MAX_MINUTES, REFRESH_DAYS (0 = refetch every game).
import { readFileSync, writeFileSync } from "node:fs";

const MIN_REVIEWS = 1000;
const MIN_PCT = 75;
const LIMIT = Number(process.env.LIMIT ?? 300);
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS ?? 90);
// Stop fetching details after this many minutes so prices and the final save
// still fit in a GitHub Actions job (6 h max).
const DEADLINE = Date.now() + Number(process.env.MAX_MINUTES ?? 1e6) * 60_000;

const UA = "patient-gamer-games-rank/1.0 (+https://github.com/SeardnaSchmid/patient-gamer-games-rank)";
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

async function json(url, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...opts.headers } });
    // Rate limited: wait it out once, then give up on this lookup.
    if (res.status === 429 && attempt === 0) { console.warn("  429, waiting 60s"); await sleep(60_000); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }
}

// --- candidates -------------------------------------------------------------

// SteamSpy pages hold 1000 games each, most-owned first, and allow 1 request
// per minute. Returns the qualifying games and whether more pages are worth asking for.
async function candidatePage(page) {
  const all = Object.values(await json(`https://steamspy.com/api.php?request=all&page=${page}`));
  const good = all.filter((g) => {
    const n = g.positive + g.negative;
    return n >= MIN_REVIEWS && (g.positive / n) * 100 >= MIN_PCT;
  }).map((g) => ({
    appid: g.appid,
    steamPct: Math.round((g.positive / (g.positive + g.negative)) * 100),
    steamReviews: g.positive + g.negative,
    steamPrice: Number(g.price) / 100,
  }));
  return { good, more: all.length === 1000 && good.length >= 20 };
}

// --- fixed values -----------------------------------------------------------

async function steam(appid) {
  const d = (await json(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`))[appid];
  if (!d?.success) throw new Error(`no Steam data for ${appid}`);
  const g = d.data;
  if (g.type !== "game") return { notAGame: true };
  const cats = new Set((g.categories ?? []).map((c) => c.description));
  const genres = new Set((g.genres ?? []).map((c) => c.description));
  const released = new Date(g.release_date.date + " UTC");
  return {
    title: g.name,
    released: isNaN(released) ? null : released.toISOString().slice(0, 10),
    metascore: g.metacritic?.score ?? null,
    metacriticUrl: g.metacritic?.url?.split("?")[0] ?? null,
    controller: cats.has("Full controller support") ? "full" : cats.has("Partial Controller Support") ? "partial" : "none",
    cloud: cats.has("Steam Cloud"),
    saveAnytime: cats.has("Save Anytime"),
    // Free-to-play with in-app purchases, or an MMO: a game that never ends by design.
    liveService: (g.is_free && cats.has("In-App Purchases")) || cats.has("MMO") || genres.has("Massively Multiplayer"),
  };
}

// Tags that describe the audience or mood rather than the kind of game.
const NOT_GENRE = new Set(["Indie", "Singleplayer", "Multiplayer", "Great Soundtrack", "Atmospheric", "Story Rich", "Classic",
  "Masterpiece", "Beautiful", "Cute", "Funny", "Colorful", "Difficult", "Female Protagonist", "Free to Play", "Early Access",
  "Controller", "Family Friendly", "Relaxing", "Addictive", "Replay Value", "Choices Matter", "Moddable", "Fantasy", "Sci-fi",
  "Casual", "Action", "Adventure", "Simulation", "Strategy", "RPG", "2D", "3D", "Pixel Graphics", "Stylized", "Cartoony",
  "Hand-drawn", "Anime", "Realistic", "First-Person", "Third Person", "Online Co-Op", "Co-op", "PvP", "Mature", "Violent",
  "Gore", "Nudity", "Sexual Content", "Dark", "Psychological", "Emotional", "Comedy", "Mythology", "Exploration"]);
// Steam lists some apps (Wallpaper Engine, …) as games; their tags give them away.
const SOFTWARE = /^(Software|Utilities|Design & Illustration|Animation & Modeling|Video Production|Audio Production|Photo Editing|Web Publishing|Game Development)$/;
async function tags(appid) {
  const t = (await json(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`)).tags;
  // SteamSpy returns [] for a game without tags, else {tag: votes} sorted by votes.
  const all = Object.keys(Array.isArray(t) ? {} : t);
  return { tags: all.filter((k) => !NOT_GENRE.has(k)).slice(0, 4), software: all.slice(0, 5).some((k) => SOFTWARE.test(k)) };
}

const DECK = { 3: "verified", 2: "playable", 1: "unsupported" };
async function deck(appid) {
  const r = await json(`https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appid}`);
  return { deck: DECK[r.results?.resolved_category] ?? "unknown" };
}

async function cheapsharkId(appid) {
  const [hit] = await json(`https://www.cheapshark.com/api/1.0/games?steamAppID=${appid}`);
  return { csId: hit?.gameID ?? null };
}

let hltbToken;
const HLTB_HEADERS = { "User-Agent": BROWSER_UA, Referer: "https://howlongtobeat.com/", Origin: "https://howlongtobeat.com" };
async function hltb(title, year) {
  hltbToken ??= (await json(`https://howlongtobeat.com/api/search/site/init?t=${Date.now()}`, { headers: HLTB_HEADERS })).token;
  const clean = title.replace(/[™®]/g, "").replace(/\s+[-–—:]\s+.*(edition|cut|remastered).*$/i, "");
  const body = {
    searchType: "games", searchTerms: clean.split(" "), searchPage: 1, size: 10,
    searchOptions: {
      games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: 0, max: 0 },
        gameplay: { perspective: "", flow: "", genre: "", difficulty: "" }, rangeYear: { min: "", max: "" }, modifier: "" },
      users: { sortCategory: "postcount" }, lists: { sortCategory: "follows" }, filter: "", sort: 0, randomizer: 0,
    },
    useCache: true,
  };
  let data;
  try {
    ({ data } = await json("https://howlongtobeat.com/api/search/site", {
      method: "POST", headers: { ...HLTB_HEADERS, "Content-Type": "application/json", "x-auth-token": hltbToken }, body: JSON.stringify(body),
    }));
  } catch (e) {
    hltbToken = undefined; // expired token is the usual cause; the next game fetches a fresh one
    throw e;
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Exact name match, then same release year. No top-hit fallback: at this
  // scale a wrong game's playtime is worse than none.
  const hit = data.find((g) => norm(g.game_name) === norm(clean)) ?? data.find((g) => g.release_world === year && norm(g.game_name).includes(norm(clean)));
  return hit?.comp_main ? { hours: Math.round(hit.comp_main / 360) / 10, hltbId: hit.game_id } : { hours: null, hltbId: null };
}

// --- prices -----------------------------------------------------------------

async function prices(games) {
  const withId = games.filter((g) => g.csId);
  for (let i = 0; i < withId.length; i += 25) {
    const batch = withId.slice(i, i + 25);
    try {
      const res = await json(`https://www.cheapshark.com/api/1.0/games?ids=${batch.map((g) => g.csId).join(",")}`);
      for (const g of batch) {
        const r = res[g.csId];
        if (!r?.deals?.length) continue;
        g.price = Math.min(...r.deals.map((d) => Number(d.price)));
        g.lowest = Number(r.cheapestPriceEver.price);
      }
    } catch (e) { console.warn(`  cheapshark batch: ${e.message}`); }
    await sleep(1000);
  }
}

// --- main -------------------------------------------------------------------

let saved = { games: [], skipped: [] };
try { saved = JSON.parse(readFileSync("games.json")); } catch {}
const previous = new Map(saved.games.map((g) => [g.appid, g]));
const skipped = new Set(saved.skipped ?? []);

// Every known game, so a partial run never drops data; games that no longer
// qualify are removed once all candidate pages are in.
const games = new Map([...previous].filter(([appid]) => !skipped.has(appid)));
const candidates = new Set();
function addCandidates(list) {
  for (const live of list) {
    if (skipped.has(live.appid)) continue;
    candidates.add(live.appid);
    games.set(live.appid, { ...games.get(live.appid), ...live });
  }
}

// Page 0 holds the most-played games; details start on those right away while
// the remaining pages (one per minute) trickle in alongside.
let page = 0;
let first = await candidatePage(page);
addCandidates(first.good);
console.log(`SteamSpy page 0: ${first.good.length} qualify`);
let allPagesIn = !first.more;
const pagesDone = (async () => {
  for (let more = first.more; more; ) {
    await sleep(61_000);
    try {
      const r = await candidatePage(++page);
      addCandidates(r.good);
      more = r.more;
      console.log(`SteamSpy page ${page}: ${r.good.length} qualify (${candidates.size} candidates)`);
    } catch (e) { console.warn(`  steamspy page ${page}: ${e.message}`); break; }
  }
  allPagesIn = true;
})();

function save(final) {
  const done = [...games.values()].filter((g) => g.fetched && g.released && (!final || candidates.has(g.appid)));
  for (const g of done) {
    g.price ??= g.steamPrice;
    g.lowest = Math.min(g.lowest ?? g.price, g.price);
  }
  const lines = done.sort((a, b) => b.steamReviews - a.steamReviews).map((g) => " " + JSON.stringify(g));
  writeFileSync("games.json", `{"updated":"${today}","skipped":${JSON.stringify([...skipped].sort((a, b) => a - b))},"games":[\n${lines.join(",\n")}\n]}\n`);
  if (final) console.log(`${done.length} games with data, ${candidates.size - done.length} candidates still waiting for details`);
}

// Never fetched first, then the stalest; most-reviewed first within each group.
const stale = (g) => !g.fetched || !g.tags || (Date.now() - new Date(g.fetched)) / 864e5 > REFRESH_DAYS;
const attempted = new Set();
function next() {
  let best;
  for (const id of candidates) {
    const g = games.get(id);
    if (attempted.has(id) || !stale(g)) continue;
    if (!best || (!!g.fetched - !!best.fetched || best.steamReviews - g.steamReviews) < 0) best = g;
  }
  return best;
}

let n = 0;
while (n < LIMIT && Date.now() < DEADLINE) {
  const game = next();
  if (!game) {
    if (allPagesIn) break;
    await sleep(5000); // wait for the next SteamSpy page
    continue;
  }
  attempted.add(game.appid);
  const started = Date.now();
  try {
    const s = await steam(game.appid);
    if (s.notAGame) { skipped.add(game.appid); candidates.delete(game.appid); games.delete(game.appid); continue; }
    Object.assign(game, s);
  } catch (e) { console.warn(`  steam ${game.appid}: ${e.message}`); await sleep(1500); continue; }
  // The other sources run side by side while Steam's rate limit (~200 appdetails
  // per 5 minutes) makes us wait anyway. A miss keeps the previous value.
  const results = await Promise.allSettled([
    deck(game.appid), tags(game.appid), cheapsharkId(game.appid), hltb(game.title, Number(game.released?.slice(0, 4))),
  ]);
  results.forEach((r, i) => r.status === "fulfilled" ? Object.assign(game, r.value) : console.warn(`  ${["deck", "tags", "cheapshark", "hltb"][i]} ${game.title}: ${r.reason.message}`));
  if (game.software) { skipped.add(game.appid); candidates.delete(game.appid); games.delete(game.appid); continue; }
  delete game.software;
  game.deck ??= "unknown";
  game.fetched = today;
  console.log(`${++n} ${game.title} · MC ${game.metascore} · ${game.steamPct}% · ${game.hours}h · deck ${game.deck} · ${game.tags?.join(", ")}`);
  if (n % 50 === 0) save(false);
  await sleep(Math.max(0, 1500 - (Date.now() - started)));
}

save(false);
await pagesDone; // games that dropped below the thresholds only count as gone once every page is in
await prices([...games.values()].filter((g) => g.fetched));
save(true);
