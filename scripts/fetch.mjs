// Builds games.json from public data. Run: node scripts/fetch.mjs
//
// Candidates   SteamSpy: every Steam game with >= MIN_REVIEWS reviews and
//              >= MIN_PCT % positive (also gives reviews and Steam price).
// Fixed values Fetched once per game and kept (refreshed after REFRESH_DAYS):
//              Steam store (release, Metascore, features), Steam Deck rating,
//              HowLongToBeat main-story hours (unofficial site API, may break).
//              At most LIMIT games get these per run, so the catalogue fills
//              up over several runs instead of hammering the APIs.
// Prices       CheapShark, 25 games per request, every run: best current price
//              across stores and the all-time low.
// A lookup that fails keeps the game's previous value. Progress is saved every
// 50 games, so the script can be stopped and restarted.
import { readFileSync, writeFileSync } from "node:fs";

const MIN_REVIEWS = 1000;
const MIN_PCT = 75;
const LIMIT = Number(process.env.LIMIT ?? 300);
const REFRESH_DAYS = 90;

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
// per minute. Stop once a page adds almost nothing.
async function candidates() {
  const found = new Map();
  for (let page = 0; page < 40; page++) {
    if (page) await sleep(61_000);
    const all = Object.values(await json(`https://steamspy.com/api.php?request=all&page=${page}`));
    const good = all.filter((g) => {
      const n = g.positive + g.negative;
      return n >= MIN_REVIEWS && (g.positive / n) * 100 >= MIN_PCT;
    });
    for (const g of good) found.set(g.appid, {
      steamPct: Math.round((g.positive / (g.positive + g.negative)) * 100),
      steamReviews: g.positive + g.negative,
      steamPrice: Number(g.price) / 100,
    });
    console.log(`SteamSpy page ${page}: ${good.length} of ${all.length} qualify (${found.size} total)`);
    if (all.length < 1000 || good.length < 20) break;
  }
  return found;
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

const found = await candidates();
const games = [...found].filter(([appid]) => !skipped.has(appid)).map(([appid, live]) => ({ ...previous.get(appid), appid, ...live }));

function save(final) {
  const done = games.filter((g) => g.fetched && g.released);
  for (const g of done) {
    g.price ??= g.steamPrice;
    g.lowest = Math.min(g.lowest ?? g.price, g.price);
  }
  const lines = done.sort((a, b) => b.steamReviews - a.steamReviews).map((g) => " " + JSON.stringify(g));
  writeFileSync("games.json", `{"updated":"${today}","skipped":${JSON.stringify([...skipped].sort((a, b) => a - b))},"games":[\n${lines.join(",\n")}\n]}\n`);
  if (final) console.log(`${done.length} games with data, ${games.length - done.length} still waiting for details`);
}

// Never fetched first, then the stalest; most-reviewed first within each group.
const stale = (g) => !g.fetched || (Date.now() - new Date(g.fetched)) / 864e5 > REFRESH_DAYS;
const todo = games.filter(stale).sort((a, b) => !!a.fetched - !!b.fetched || b.steamReviews - a.steamReviews).slice(0, LIMIT);
console.log(`${games.length} candidates, fetching details for ${todo.length}`);

let n = 0;
for (const game of todo) {
  try {
    const s = await steam(game.appid);
    if (s.notAGame) { skipped.add(game.appid); game.fetched = null; continue; }
    Object.assign(game, s);
    Object.assign(game, await deck(game.appid));
    await sleep(1500); // Steam's appdetails allows ~200 requests per 5 minutes
  } catch (e) { console.warn(`  steam ${game.appid}: ${e.message}`); continue; }
  try { Object.assign(game, await cheapsharkId(game.appid)); } catch (e) { console.warn(`  cheapshark ${game.title}: ${e.message}`); }
  try { Object.assign(game, await hltb(game.title, Number(game.released?.slice(0, 4)))); } catch (e) { console.warn(`  hltb ${game.title}: ${e.message}`); }
  game.fetched = today;
  console.log(`${++n}/${todo.length} ${game.title} · MC ${game.metascore} · ${game.steamPct}% · ${game.hours}h · deck ${game.deck}`);
  if (n % 50 === 0) save(false);
}

await prices(games.filter((g) => g.fetched));
save(true);
