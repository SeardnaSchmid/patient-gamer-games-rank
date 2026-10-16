// Pure scoring, shared by the page and score.test.js. Every input is a fetched
// value (see scripts/fetch.mjs); each part carries the value it was based on so
// the page can show why a game scored what it did.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Linear ramp: 0 at `from`, `max` at `to` (works for descending ranges too).
const ramp = (v, from, to, max) => clamp((v - from) / (to - from), 0, 1) * max;

export function ageMonths(game, now = new Date()) {
  const d = new Date(game.released);
  return (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
}

// Metascore and Steam % positive averaged; whichever exists if only one does.
export function quality(game) {
  const s = [game.metascore, game.steamPct].filter((v) => v != null);
  return s.length ? s.reduce((a, b) => a + b) / s.length : null;
}

const qualityNote = (g) => [g.metascore != null && `Metascore ${g.metascore}`, g.steamPct != null && `Steam ${g.steamPct}%`].filter(Boolean).join(", ") || "no ratings";

export function patientScore(game, now) {
  const age = ageMonths(game, now);
  const q = quality(game);
  // 1 when today's price is the all-time low, 0 at twice the low or more.
  const nearLow = game.price === 0 ? 1 : clamp(2 - game.price / Math.max(game.lowest, 0.01), 0, 1);
  return total({
    Maturity: [ramp(age, 6, 24, 25), `${Math.floor(age / 12)}y ${age % 12}m since release`],
    Price: [ramp(game.price, 40, 10, 25), `best price now $${game.price}`],
    "Near all-time low": [nearLow * 15, `low $${game.lowest} (CheapShark)`],
    Quality: [q == null ? 0 : ramp(q, 60, 95, 25), qualityNote(game)],
    "Players beat critics": [game.steamPct != null && game.metascore != null && game.steamPct > game.metascore ? 5 : 0, "Steam % above Metascore"],
    "Complete edition": [/complete|definitive|goty|game of the year|director's cut|final cut|remastered|legendary|intergrade|ultimate|enhanced/i.test(game.title) ? 5 : 0, "edition named in title"],
    "Live service": [game.liveService ? -15 : 0, "free-to-play with in-app purchases, or MMO"],
  });
}

const DECK = { verified: 15, playable: 8 };
export function dadScore(game) {
  const q = quality(game);
  return total({
    Finishable: [game.hours == null ? 0 : ramp(game.hours, 60, 10, 30), game.hours == null ? "no HowLongToBeat time" : `${game.hours}h main story (HowLongToBeat)`],
    Quality: [q == null ? 0 : ramp(q, 60, 95, 25), qualityNote(game)],
    "Steam Deck": [DECK[game.deck] ?? 0, `Deck ${game.deck}`],
    Controller: [game.controller === "full" ? 10 : game.controller === "partial" ? 5 : 0, `${game.controller} controller support`],
    "Cloud saves": [game.cloud ? 10 : 0, "Steam Cloud"],
    "Save anytime": [game.saveAnytime ? 10 : 0, "Steam tag"],
    "Live service": [game.liveService ? -20 : 0, "free-to-play with in-app purchases, or MMO"],
  });
}

function total(parts) {
  const score = Math.round(clamp(Object.values(parts).reduce((a, [p]) => a + p, 0), 0, 100));
  return { score, parts };
}
