import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { worthScore, dadScore, multiplayerScore, rating, ageMonths, isPatient } from "./score.js";

const now = new Date("2026-10-01");
const base = {
  title: "Game", released: "2023-01-15", metascore: 90, steamPct: 95, steamReviews: 50000,
  recentPct: 95, recentReviews: 2000, launchPct: 85, launchReviews: 5000, prevReviews: 2000,
  regularPrice: 40, hours: 10, deck: "verified", controller: "full", cloud: true, saveAnytime: true,
  liveService: false, earlyAccess: false, onlineCoop: false, onlinePvp: false, mmo: false, ccu: 5000, lastNews: "2026-09-01",
};

test("rating pulls small samples toward 50 %", () => {
  assert.ok(rating(98, 40) < rating(95, 40000));
  assert.ok(Math.abs(rating(95, 1e7) - 95) < 0.5);
  assert.equal(rating(null, 10), null);
});

test("worth the wait blends players and critics 60/40", () => {
  const { score, parts } = worthScore(base); // 95 % of 2,000 recent reviews rates 90.4
  assert.equal(Math.round(parts.Players[0]), 54);
  assert.equal(parts.Critics[0], 36);
  assert.equal(score, 90);
});

test("players weigh every source with enough ratings by the digits of its rating count", () => {
  const g = { ...base, mcUser: 8, mcUsers: 1000, gogScore: 4.5, gogReviews: 20, hltbScore: 86, hltbReviews: 500 };
  const [points, , sources] = worthScore(g).parts.Players;
  // weights: Steam 2,000 reviews → 3.3, Metacritic 1,000 → 3, HowLongToBeat 500 → 2.7
  const w = [Math.log10(2000), 3, Math.log10(500)];
  assert.ok(Math.abs(points / 0.6 - (rating(95, 2000) * w[0] + 80 * w[1] + 86 * w[2]) / (w[0] + w[1] + w[2])) < 1e-9);
  assert.deepEqual(sources.map(([src, v]) => [src, v && Math.round(v)]), [["Steam", 90], ["Metacritic users", 80], ["GOG", null], ["HowLongToBeat", 86]]);
  assert.match(sources[0][2], /^weight 37% · /);
  assert.equal(sources[2][2], "only 20 ratings, too few");
});

test("Metacritic's page beats the Metascore Steam shows", () => {
  assert.equal(worthScore({ ...base, mcScore: 70 }).parts.Critics[0], 28);
});

test("a missing side is left out, not counted as zero", () => {
  assert.equal(worthScore({ ...base, metascore: null }).score, 90); // players alone
  assert.equal(worthScore({ ...base, steamPct: null, recentReviews: 0 }).score, 90); // critics alone
});

test("a bad launch that was fixed does not beat a game that was great all along", () => {
  const fixed = worthScore({ ...base, launchPct: 60, recentPct: 85 }).score;
  assert.ok(fixed < worthScore(base).score);
});

test("multiplayer score only for online games, and rewards a living community", () => {
  assert.equal(multiplayerScore(base, now), null);
  const alive = multiplayerScore({ ...base, onlineCoop: true, ccu: 20000 }, now).score;
  const dead = multiplayerScore({ ...base, onlineCoop: true, ccu: 20, recentReviews: 100, prevReviews: 1000, lastNews: "2023-01-01" }, now).score;
  assert.ok(alive > 90 && dead < 30, `${alive} / ${dead}`);
});

test("long games lose Gamer Dad points", () => {
  assert.ok(dadScore({ ...base, hours: 80 }).score < dadScore(base).score - 25);
});

test("Gamer Dad quality follows Worth the wait", () => {
  assert.equal(dadScore(base).parts.Quality[1], `Worth the wait ${worthScore(base).score}`);
  assert.ok(dadScore({ ...base, metascore: 60, recentPct: 70 }).parts.Quality[0] < dadScore(base).parts.Quality[0]);
});

test("missing data scores zero, not NaN", () => {
  const g = { ...base, metascore: null, steamPct: null, recentPct: null, recentReviews: 0, launchPct: null, launchReviews: 0, hours: null, deck: "unknown" };
  for (const s of [worthScore(g), dadScore(g), multiplayerScore({ ...g, onlinePvp: true }, now)]) {
    assert.ok(Number.isFinite(s.score));
  }
});

test("patient games are a year old and finished", () => {
  assert.ok(isPatient(base, now));
  assert.ok(!isPatient({ ...base, released: "2026-01-01" }, now));
  assert.ok(!isPatient({ ...base, earlyAccess: true }, now));
  assert.ok(isPatient({ ...base, earlyAccess: true }, now, true)); // opted in: a year in Early Access is enough
  assert.ok(!isPatient({ ...base, earlyAccess: true, released: "2026-01-01" }, now, true));
  assert.ok(!isPatient({ ...base, liveService: true }, now));
});

test("age in months", () => assert.equal(ageMonths(base, now), 45));

test("every fetched game has the fields the scores need", () => {
  const { games } = JSON.parse(readFileSync(new URL("./games.json", import.meta.url)));
  assert.ok(games.length > 0);
  for (const g of games) {
    for (const k of ["appid", "title", "released", "regularPrice", "deck", "controller"]) assert.ok(g[k] != null, `${g.title}: ${k}`);
    assert.match(g.released, /^\d{4}-\d{2}-\d{2}$/, g.title);
  }
});
