// Pure scoring, shared by the page and score.test.js. Every rule returns points
// so the UI can show the breakdown, not just the total.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Linear ramp: 0 at `from`, `max` at `to` (works for descending ranges too).
const ramp = (v, from, to, max) => clamp((v - from) / (to - from), 0, 1) * max;

export function ageMonths(game, now = new Date()) {
  const [y, m] = game.released.split("-").map(Number);
  return (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
}

// Critic and user score averaged; a user score above the metascore means it got fixed.
export function quality(game) {
  return game.user == null ? game.meta : (game.meta + game.user * 10) / 2;
}

export function patientScore(game, now) {
  const parts = {
    Maturity: ramp(ageMonths(game, now), 6, 24, 35),
    Price: ramp(game.price, 40, 10, 30),
    Quality: ramp(quality(game), 60, 95, 20),
    "Fixed since launch": game.user != null && game.user * 10 > game.meta ? 5 : 0,
    "Complete edition": game.complete ? 10 : 0,
    "Live service": game.liveService ? -15 : 0,
  };
  return total(parts);
}

export function dadScore(game) {
  const parts = {
    Finishable: ramp(game.hours, 60, 10, 35),
    Quality: ramp(quality(game), 60, 95, 30),
    "Short sessions": game.bursts ? 20 : 0,
    Handheld: game.handheld ? 15 : 0,
    "Live service": game.liveService ? -20 : 0,
  };
  return total(parts);
}

function total(parts) {
  const score = Math.round(clamp(Object.values(parts).reduce((a, b) => a + b, 0), 0, 100));
  return { score, parts };
}
