// Pure scoring, shared by the page and the tests. Every input is a fetched
// value (see scripts/fetch.mjs); each part carries the value it is based on so
// the page can show the reasoning.
//
//   Worth the wait  How good is the game today?
//   Gamer Dad    Does it fit a busy life?
//   Multiplayer  Is the online part still alive, years on?    (online games only)

const DAY = 864e5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Linear ramp: 0 at `from`, `max` at `to` (works for descending ranges too).
const ramp = (v, from, to, max) => clamp((v - from) / (to - from), 0, 1) * max;
export const fmtN = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

export function ageMonths(game, now = new Date()) {
  const d = new Date(game.released);
  return (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
}

// SteamDB's rating: pulls the positive share toward 50 % the fewer reviews
// there are, so 98 % of 40 reviews doesn't beat 95 % of 40,000.
export function rating(pct, n) {
  if (pct == null || !n) return null;
  const p = pct / 100;
  return (p - (p - 0.5) * 2 ** -Math.log10(n + 1)) * 100;
}

// Quality today: the last 6 months of Steam reviews when there are enough,
// otherwise all of them.
export function qualityNow(g) {
  const recent = g.recentReviews >= 50;
  const pct = recent ? g.recentPct : g.steamPct;
  const n = recent ? g.recentReviews : g.steamReviews;
  return { value: rating(pct, n), n, note: `${pct}% of ${fmtN(n)} Steam reviews${recent ? " in the last 6 months" : ""}` };
}

export const isOnline = (g) => !!(g.onlineCoop || g.onlinePvp || g.mmo);

// A patient game: out for a year, and finished (not Early Access, not live service).
// With allowEarlyAccess, a game in Early Access for a year counts too (Steam dates
// an Early Access game from its Early Access launch, a finished one from 1.0).
export const isPatient = (g, now = new Date(), allowEarlyAccess = false) =>
  ageMonths(g, now) >= 12 && (allowEarlyAccess || !g.earlyAccess) && !g.liveService;

// Positive-% points gained since the launch quarter, or null when there is no
// fair comparison yet (too young, or too few reviews in either window).
export function launchTrend(g, now = new Date()) {
  return ageMonths(g, now) >= 9 && g.launchReviews >= 20 && g.recentReviews >= 20 ? g.recentPct - g.launchPct : null;
}

// Fewer ratings than this and a source says little; it is left out.
const MIN_RATINGS = 50;

// Every player source, each on 0–100: [source, value or null, basis, ratings].
// A source without enough ratings has value null and says why, so the page can show it.
export function playerRatings(g) {
  const q = qualityNow(g);
  const src = (name, n, value, basis) =>
    [name, n >= MIN_RATINGS ? value : null, !n ? "no rating" : n >= MIN_RATINGS ? basis : `only ${n} ratings, too few`, n];
  return [
    ["Steam", q.value, q.value == null ? "no reviews" : `${q.note}, adjusted for how many`, q.n],
    src("Metacritic users", g.mcUsers, g.mcUser * 10, `${g.mcUser}/10 from ${fmtN(g.mcUsers ?? 0)} ratings`),
    src("GOG", g.gogReviews, g.gogScore * 20, `${g.gogScore}/5 from ${fmtN(g.gogReviews ?? 0)} reviews`),
    src("HowLongToBeat", g.hltbReviews, g.hltbScore, `${g.hltbScore}% from ${fmtN(g.hltbReviews ?? 0)} reviews`),
  ];
}

// Metacritic's own page first (all platforms), else the score Steam shows.
export const metascore = (g) => g.mcScore ?? g.metascore ?? null;

// How good the game is today, on a review scale: players and critics blended
// 60/40. Players is the average of every source with enough ratings, each
// weighted by the digits of its rating count (log10): 1,000 ratings weigh 3,
// 1 million weigh 6. More ratings count more, but Steam's millions can't drown
// out the other sites (weighting by the count itself would). A missing source
// is left out, not counted as zero. Being finished is the
// patient filter and the change since launch is shown on the card; neither
// adds points (recent reviews already show a game that was fixed).
// ponytail: sources run on different scales (Steam is % positive, the others
// are average ratings, usually lower), so fewer sources tends to mean a higher
// score; calibrate each source against Steam if that skews the ranking.
const WORTH = { Players: 0.6, Critics: 0.4 };
export function worthScore(g) {
  const players = playerRatings(g);
  const w = (src) => (src[1] == null ? 0 : Math.log10(src[3]));
  const sum = players.reduce((a, src) => a + w(src), 0);
  const mc = metascore(g);
  // Each side: [value, how it is made, the sources behind it as [source, value, basis]].
  const sides = {
    Players: [sum ? players.reduce((a, src) => a + src[1] * w(src), 0) / sum : null,
      sum ? "weighted by number of ratings" : "no player ratings",
      players.map((src) => [src[0], src[1], src[1] == null ? src[2] : `weight ${Math.round((w(src) / sum) * 100)}% · ${src[2]}`])],
    Critics: [mc, mc == null ? "no Metascore" : "Metascore",
      [["Metacritic", mc, mc == null ? "no Metascore" : g.mcCritics ? `from ${g.mcCritics} critics` : "as shown on Steam"]]],
  };
  const weight = Object.entries(sides).reduce((a, [k, [v]]) => a + (v == null ? 0 : WORTH[k]), 0);
  return total(Object.fromEntries(Object.entries(sides).map(([k, [v, how, sources]]) =>
    [k, v == null ? [0, how, sources] : [(v * WORTH[k]) / weight, `${Math.round(v)} × ${Math.round((WORTH[k] / weight) * 100)}% · ${how}`, sources]])));
}

// Short enough to finish, good enough to be worth the few hours there are, and
// playable on the couch or a Steam Deck in short sessions. (Live service games
// never get here: they aren't patient games.)
const DECK = { verified: 15, playable: 8 };
export function dadScore(g) {
  const worth = worthScore(g).score;
  return total({
    Finishable: [g.hours == null ? 0 : ramp(g.hours, 60, 10, 30), g.hours == null ? "no HowLongToBeat time" : `${g.hours}h main story (HowLongToBeat)`],
    Quality: [ramp(worth, 70, 95, 25), `Worth the wait ${worth}`],
    "Steam Deck": [DECK[g.deck] ?? 0, `Deck ${g.deck}`],
    Controller: [g.controller === "full" ? 10 : g.controller === "partial" ? 5 : 0, `${g.controller} controller support`],
    "Cloud saves": [g.cloud ? 10 : 0, "Steam Cloud"],
    "Save anytime": [g.saveAnytime ? 10 : 0, "Steam tag"],
  });
}

// null for games without online play.
export function multiplayerScore(g, now = new Date()) {
  if (!isOnline(g)) return null;
  const q = qualityNow(g);
  const activity = g.prevReviews >= 20 ? g.recentReviews / g.prevReviews : null;
  const newsDays = g.lastNews ? (now - Date.parse(g.lastNews)) / DAY : null;
  return total({
    Players: [g.ccu ? ramp(Math.log10(g.ccu), 1.5, 4, 35) : 0, g.ccu ? `${fmtN(g.ccu)} peak players yesterday (SteamSpy)` : "no player count"],
    Activity: [activity == null ? 0 : ramp(activity, 0.4, 1, 25),
      activity == null ? "too few reviews to compare" : `${fmtN(g.recentReviews)} reviews in the last 6 months vs ${fmtN(g.prevReviews)} the 6 before`],
    "Quality now": [q.value == null ? 0 : ramp(q.value, 70, 95, 25), q.note],
    "Still updated": [newsDays == null ? 0 : ramp(newsDays, 365, 90, 15), g.lastNews ? `last announcement ${g.lastNews}` : "no announcements"],
  });
}

function total(parts) {
  const score = Math.round(clamp(Object.values(parts).reduce((a, [p]) => a + p, 0), 0, 100));
  return { score, parts };
}
