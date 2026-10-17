// Builds games.json from public data. Run: node scripts/fetch.mjs
//
// Candidates   SteamSpy: every Steam game with >= MIN_REVIEWS reviews and
//              >= MIN_PCT % positive (also gives reviews and Steam's list price).
// Fixed values Fetched once per game and kept (refreshed after REFRESH_DAYS):
//              Steam store (release, short description, Metascore, features), Steam Deck rating,
//              SteamSpy user tags (genres like "Metroidvania", not Steam's coarse ones),
//              HowLongToBeat main-story hours and user rating (unofficial site API, may break).
//              At most LIMIT games get these per run, so the catalogue fills
//              up over several runs instead of hammering the APIs.
// Monthly      Steam review histogram (positive % at launch, in the last 6
//              months, review activity), the last Steam announcement, the
//              Metacritic page (Metascore and user score; unofficial, may break)
//              and the GOG user rating. Each is optional: a game missing from
//              Metacritic or GOG just has no value from it.
//              Refreshed after 30 days, at most MONTHLY_LIMIT games per run.
// A lookup that fails keeps the game's previous value. Progress is saved every
// 50 games, so the script can be stopped and restarted.
// Env: LIMIT, MAX_MINUTES, REFRESH_DAYS (0 = refetch every game), MONTHLY_LIMIT.
import { readFileSync, writeFileSync } from "node:fs";

const MIN_REVIEWS = 1000;
const MIN_PCT = 75;
const LIMIT = Number(process.env.LIMIT ?? 300);
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS ?? 90);
const MONTHLY_LIMIT = Number(process.env.MONTHLY_LIMIT ?? 1500);
// Stop fetching details after this many minutes so the final save still fits
// in a GitHub Actions job (6 h max).
const DEADLINE = Date.now() + Number(process.env.MAX_MINUTES ?? 1e6) * 60_000;

const UA = "patient-gamer-games-rank/1.0 (+https://github.com/SeardnaSchmid/patient-gamer-games-rank)";
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// The title without trademark signs and edition suffixes, for searching other sites.
const cleanTitle = (t) => t.replace(/[™®]/g, "").replace(/\s+[-–—:]\s+.*(edition|cut|remastered).*$/i, "");
// Steam's short descriptions come HTML-escaped ("Dungeons &amp; Dragons").
const ENTITIES = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
const unescapeHtml = (s) => s.replace(/&(#\d+|amp|quot|apos|lt|gt);/g, (_, e) => (e[0] === "#" ? String.fromCharCode(e.slice(1)) : ENTITIES[e]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

async function json(url, opts = {}, as = "json") {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...opts.headers } });
    // Rate limited by Steam: wait it out once, then give up on this lookup. Steam
    // sets the pace of the whole run anyway. Any other site just misses (the
    // game keeps its old value): waiting would stall every game behind it.
    if (res.status === 429 && attempt === 0 && /steampowered\.com|steamspy\.com/.test(url)) { console.warn("  429, waiting 60s"); await sleep(60_000); continue; }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res[as]();
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
    regularPrice: Number(g.initialprice) / 100, // Steam list price
    ccu: g.ccu, // peak concurrent players yesterday
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
    description: unescapeHtml(g.short_description ?? "") || null,
    released: isNaN(released) ? null : released.toISOString().slice(0, 10),
    metascore: g.metacritic?.score ?? null,
    metacriticUrl: g.metacritic?.url?.split("?")[0] ?? null,
    controller: cats.has("Full controller support") ? "full" : cats.has("Partial Controller Support") ? "partial" : "none",
    cloud: cats.has("Steam Cloud"),
    saveAnytime: cats.has("Save Anytime"),
    // Free-to-play with in-app purchases, or an MMO: a game that never ends by design.
    liveService: (g.is_free && cats.has("In-App Purchases")) || cats.has("MMO") || genres.has("Massively Multiplayer"),
    earlyAccess: genres.has("Early Access"),
    singleplayer: cats.has("Single-player"),
    onlineCoop: cats.has("Online Co-op"),
    onlinePvp: cats.has("Online PvP"),
    mmo: cats.has("MMO") || genres.has("Massively Multiplayer"),
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

// Steam's review histogram: up/down votes per month (per week for young games)
// since launch. Gives "was it fixed?" on one scale, and review activity as a
// stand-in for how alive a game still is.
const DAY = 864e5;
async function reviewHistory(appid) {
  const r = (await json(`https://store.steampowered.com/appreviewhistogram/${appid}?l=english&review_score_preference=0`)).results;
  const rows = r.rollups.map((x) => ({ t: x.date * 1000, up: x.recommendations_up, down: x.recommendations_down }));
  const sum = (from, to) => rows.filter((x) => x.t >= from && x.t < to).reduce((a, x) => ({ up: a.up + x.up, down: a.down + x.down }), { up: 0, down: 0 });
  const pct = ({ up, down }) => (up + down ? Math.round((up / (up + down)) * 100) : null);
  const start = rows[0]?.t ?? Date.now(), now = Date.now();
  const launch = sum(start, start + 90 * DAY), recent = sum(now - 182 * DAY, now + DAY), prev = sum(now - 365 * DAY, now - 182 * DAY);
  return {
    launchPct: pct(launch), launchReviews: launch.up + launch.down,
    recentPct: pct(recent), recentReviews: recent.up + recent.down,
    prevReviews: prev.up + prev.down,
  };
}

async function lastNews(appid) {
  const [item] = (await json(`https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=1&feeds=steam_community_announcements`)).appnews.newsitems;
  return { lastNews: item ? new Date(item.date * 1000).toISOString().slice(0, 10) : null };
}

let hltbToken;
const HLTB_HEADERS = { "User-Agent": BROWSER_UA, Referer: "https://howlongtobeat.com/", Origin: "https://howlongtobeat.com" };
async function hltb(title, year) {
  hltbToken ??= (await json(`https://howlongtobeat.com/api/search/site/init?t=${Date.now()}`, { headers: HLTB_HEADERS })).token;
  const clean = cleanTitle(title);
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
  // Exact name match, then same release year. No top-hit fallback: at this
  // scale a wrong game's playtime is worse than none.
  const hit = data.find((g) => norm(g.game_name) === norm(clean)) ?? data.find((g) => g.release_world === year && norm(g.game_name).includes(norm(clean)));
  return hit
    ? { hours: hit.comp_main ? Math.round(hit.comp_main / 360) / 10 : null, hltbId: hit.game_id, hltbScore: hit.review_score || null, hltbReviews: hit.count_review }
    : { hours: null, hltbId: null, hltbScore: null, hltbReviews: null };
}

// Metacritic's game page: Metascore across platforms and the user score (0–10).
// Steam's Metacritic link gives the page. Without one, or when it moved (over
// HTTP/1.1 Metacritic answers a move with a 301 that has no target), the
// address is guessed from the title and only kept when the page's title and
// release year match.
const NO_MC = { mcScore: null, mcCritics: null, mcUser: null, mcUsers: null, mcUrl: null };
async function metacritic(game) {
  const linked = game.metacriticUrl?.split("/").filter(Boolean).at(-1);
  const guessed = cleanTitle(game.title).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let url, html;
  for (const slug of new Set([linked, guessed].filter(Boolean))) {
    url = `https://www.metacritic.com/game/${slug}/`;
    html = await json(url, { headers: { "User-Agent": BROWSER_UA }, redirect: "manual" }, "text")
      .catch((e) => { if (/^(301|404) /.test(e.message)) return null; throw e; });
    if (!html) continue;
    const title = html.match(/<title>(.*?) Reviews - Metacritic/)?.[1].replace(/&[^;]+;/g, "") ?? "";
    const year = Number(html.match(/"datePublished":"(\d{4})/)?.[1]);
    if (slug === linked || (norm(title) === norm(cleanTitle(game.title)) && Math.abs(year - Number(game.released?.slice(0, 4))) <= 1)) break;
    html = null;
  }
  if (!html) return NO_MC;
  const critic = html.match(/"name":"Metascore"[^}]*?"ratingValue":(\d+),"reviewCount":(\d+)/);
  // The page's first user score is the game's own, the later ones are per platform.
  const user = html.replace(/<[^>]+>/g, " ").match(/User score\s+[\w\s]*?Based on ([\d,]+) User Ratings?\s+(\d+(?:\.\d)?)/);
  return {
    mcScore: critic ? Number(critic[1]) : null, mcCritics: critic ? Number(critic[2]) : null,
    mcUser: user ? Number(user[2]) : null, mcUsers: user ? Number(user[1].replace(/,/g, "")) : null,
    mcUrl: critic || user ? url : null,
  };
}

// GOG's store rating (0–5) for the same game, matched by title and release year
// (a Steam re-release years later finds nothing, like HowLongToBeat: no wrong game).
async function gog(game) {
  const clean = cleanTitle(game.title);
  // GOG answers 400 for a search without results.
  const found = await json(`https://catalog.gog.com/v1/catalog?limit=10&productType=in:game&query=like:${encodeURIComponent(clean.replace(/[^\w\s]/g, " "))}`)
    .catch((e) => { if (e.message.startsWith("400")) return { products: [] }; throw e; });
  const year = Number(game.released?.slice(0, 4));
  const hit = found.products.find((p) => norm(p.title) === norm(clean) && Math.abs(Number(p.releaseDate?.slice(0, 4)) - year) <= 1);
  return hit?.reviewsCount ? { gogScore: hit.reviewsRating / 10, gogReviews: hit.reviewsCount, gogSlug: hit.slug } : { gogScore: null, gogReviews: null, gogSlug: null };
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
  // Leftovers from when prices were tracked daily; they would only go stale.
  for (const g of done) for (const k of ["price", "lowest", "steamPrice", "csId"]) delete g[k];
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

// A game fetched before the GOG lookup existed is due at once, so new sources fill in on the next run.
const monthlyDue = (g) => !g.monthly || !("gogScore" in g) || (Date.now() - new Date(g.monthly)) / DAY > 30;
let n = 0, monthly = 0;
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
  const sources = { deck: deck(game.appid), tags: tags(game.appid), hltb: hltb(game.title, Number(game.released?.slice(0, 4))) };
  const doMonthly = monthlyDue(game) && monthly < MONTHLY_LIMIT;
  if (doMonthly) Object.assign(sources, { reviews: reviewHistory(game.appid), news: lastNews(game.appid), metacritic: metacritic(game), gog: gog(game) });
  const results = await Promise.allSettled(Object.values(sources));
  const names = Object.keys(sources);
  results.forEach((r, i) => r.status === "fulfilled" ? Object.assign(game, r.value) : console.warn(`  ${names[i]} ${game.title}: ${r.reason.message}`));
  // Mark the monthly values fresh once the histogram came back; otherwise retry next run.
  // (The news API refuses some apps for good, so it doesn't hold this up.)
  if (doMonthly && results[names.indexOf("reviews")].status === "fulfilled") { game.monthly = today; monthly++; }
  if (game.software) { skipped.add(game.appid); candidates.delete(game.appid); games.delete(game.appid); continue; }
  delete game.software;
  game.deck ??= "unknown";
  game.fetched = today;
  console.log(`${++n} ${game.title} · MC ${game.metascore} · ${game.steamPct}% (launch ${game.launchPct}%, recent ${game.recentPct}%) · ${game.hours}h · deck ${game.deck} · ${game.tags?.join(", ")}`);
  if (n % 50 === 0) save(false);
  await sleep(Math.max(0, 1500 - (Date.now() - started)));
}

save(false);
await pagesDone; // games that dropped below the thresholds only count as gone once every page is in
save(true);
