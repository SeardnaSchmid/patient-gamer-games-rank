// Pure scoring, shared by the page and the tests. Every input is a fetched
// value (see scripts/fetch.mjs) or derived from the price history; each part
// carries the value it is based on so the page can show the reasoning.
//
//   Worth it     Is the game good and finished today?        (patient gamer)
//   Buy now      Is today a good moment to buy it?            (patient gamer)
//   Gamer Dad    Does it fit a busy schedule?
//   Multiplayer  Is the online part still alive, years on?    (online games only)

const DAY = 864e5;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Linear ramp: 0 at `from`, `max` at `to` (works for descending ranges too).
const ramp = (v, from, to, max) => clamp((v - from) / (to - from), 0, 1) * max;
const fmtN = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

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
// otherwise all of them. One scale for every game; Metascore stays separate.
export function qualityNow(g) {
  const recent = g.recentReviews >= 50;
  const pct = recent ? g.recentPct : g.steamPct;
  const n = recent ? g.recentReviews : g.steamReviews;
  return { value: rating(pct, n), note: `${pct}% of ${fmtN(n)} Steam reviews${recent ? " in the last 6 months" : ""}` };
}

export const isOnline = (g) => !!(g.onlineCoop || g.onlinePvp || g.mmo);

export function worthScore(g, now = new Date()) {
  const age = ageMonths(g, now);
  const q = qualityNow(g);
  // The launch quarter and the last 6 months only compare once they don't overlap.
  const trend = age >= 9 && g.launchReviews >= 20 && g.recentReviews >= 20 ? g.recentPct - g.launchPct : null;
  return total({
    "Quality now": [q.value == null ? 0 : ramp(q.value, 70, 95, 50), q.note],
    // Held up (±0) earns 15 of 25, fixed since launch earns the rest.
    "Since launch": [trend == null ? 0 : ramp(trend, -15, 10, 25),
      trend != null ? `${g.launchPct}% at launch → ${g.recentPct}% now` : age < 9 ? "too new to compare" : "no review history yet"],
    Finished: g.earlyAccess ? [0, "Early Access"]
      : g.liveService ? [0, "live service, never finished by design"]
      : [ramp(age, 6, 12, 15), `${Math.floor(age / 12)}y ${age % 12}m since release`],
    Critics: [g.metascore == null ? 0 : ramp(g.metascore, 60, 95, 10), g.metascore == null ? "no Metascore" : `Metascore ${g.metascore}`],
  });
}

// null for a game that is free anyway: there is nothing to wait for.
export function dealScore(g) {
  if (!g.price && !g.regularPrice) return null;
  const regular = Math.max(g.regularPrice ?? 0, g.price);
  const discount = 1 - g.price / regular;
  // 1 at the all-time low, 0 at twice the low or more.
  const nearLow = g.lowest ? clamp(2 - g.price / g.lowest, 0, 1) : 0;
  // The typical price needs our own history; until then the other two share its weight.
  const [wDiscount, wLow] = g.typical ? [40, 40] : [50, 50];
  return total({
    Discount: [ramp(discount, 0, 0.75, wDiscount), discount > 0.005 ? `${Math.round(discount * 100)}% off the $${regular} list price` : `list price $${regular}`],
    "All-time low": [nearLow * wLow, g.lowest == null ? "all-time low unknown" : g.price <= g.lowest ? `at the all-time low $${g.lowest} (CheapShark)` : `low is $${g.lowest} (CheapShark)`],
    "Typical price": g.typical ? [ramp(g.price / g.typical, 1.1, 0.8, 20), `usually $${g.typical} (tracked here)`] : [0, "needs 30 days of price history"],
  });
}

const DECK = { verified: 15, playable: 8 };
export function dadScore(g) {
  const q = qualityNow(g);
  return total({
    Finishable: [g.hours == null ? 0 : ramp(g.hours, 60, 10, 30), g.hours == null ? "no HowLongToBeat time" : `${g.hours}h main story (HowLongToBeat)`],
    Quality: [q.value == null ? 0 : ramp(q.value, 70, 95, 25), q.note],
    "Steam Deck": [DECK[g.deck] ?? 0, `Deck ${g.deck}`],
    Controller: [g.controller === "full" ? 10 : g.controller === "partial" ? 5 : 0, `${g.controller} controller support`],
    "Cloud saves": [g.cloud ? 10 : 0, "Steam Cloud"],
    "Save anytime": [g.saveAnytime ? 10 : 0, "Steam tag"],
    "Live service": [g.liveService ? -20 : 0, "free-to-play with in-app purchases, or MMO"],
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

// The price a game sat at for at least half of the tracked time. points are
// [time ms, price] sorted by time; each holds until the next one, the last
// until `end`. null until 30 days are tracked.
export function typicalPrice(points, end) {
  if (!points.length || end - points[0][0] < 30 * DAY) return null;
  const spans = points.map(([t, p], i) => [p, (points[i + 1]?.[0] ?? end) - t]).sort((a, b) => a[0] - b[0]);
  let acc = 0;
  const half = (end - points[0][0]) / 2;
  for (const [p, d] of spans) if ((acc += d) >= half) return p;
  return spans.at(-1)[0];
}

function total(parts) {
  const score = Math.round(clamp(Object.values(parts).reduce((a, [p]) => a + p, 0), 0, 100));
  return { score, parts };
}
