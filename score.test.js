import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { worthScore, dealScore, dadScore, multiplayerScore, typicalPrice, rating, ageMonths, isPatient } from "./score.js";

const DAY = 864e5;
const now = new Date("2026-10-01");
const base = {
  title: "Game", released: "2023-01-15", metascore: 90, steamPct: 95, steamReviews: 50000,
  recentPct: 95, recentReviews: 2000, launchPct: 85, launchReviews: 5000, prevReviews: 2000,
  price: 10, regularPrice: 40, lowest: 10, hours: 10, deck: "verified", controller: "full", cloud: true, saveAnytime: true,
  liveService: false, earlyAccess: false, onlineCoop: false, onlinePvp: false, mmo: false, ccu: 5000, lastNews: "2026-09-01",
};

test("rating pulls small samples toward 50 %", () => {
  assert.ok(rating(98, 40) < rating(95, 40000));
  assert.ok(Math.abs(rating(95, 1e7) - 95) < 0.5);
  assert.equal(rating(null, 10), null);
});

test("a fixed, finished, well-reviewed game is worth it", () => {
  const { score, parts } = worthScore(base, now);
  assert.equal(parts["Since launch"][0], 25); // 85 % → 95 %
  assert.equal(parts.Finished[0], 15);
  assert.ok(score >= 85, `got ${score}`); // 95 % of 2,000 recent reviews rates 90.4 → 41 of 50
});

test("a game that got worse since launch loses the trend points", () => {
  assert.equal(worthScore({ ...base, launchPct: 95, recentPct: 78 }, now).parts["Since launch"][0], 0);
});

test("early access and live service are never finished", () => {
  assert.equal(worthScore({ ...base, earlyAccess: true }, now).parts.Finished[0], 0);
  assert.equal(worthScore({ ...base, liveService: true }, now).parts.Finished[0], 0);
});

test("a young game is not compared with its own launch", () => {
  assert.equal(worthScore({ ...base, released: "2026-06-01" }, now).parts["Since launch"][1], "too new to compare");
});

test("75 % off at the all-time low is the best deal; full price far above the low is none", () => {
  assert.equal(dealScore(base).score, 100);
  assert.equal(dealScore({ ...base, price: 40, lowest: 10 }).score, 0);
});

test("the typical price takes a share of the deal once there is history", () => {
  const { parts } = dealScore({ ...base, typical: 20 });
  assert.equal(parts.Discount[0], 40);
  assert.equal(parts["Typical price"][0], 20);
});

test("an unknown all-time low earns nothing instead of counting as reached", () => {
  assert.equal(dealScore({ ...base, lowest: null }).parts["All-time low"][0], 0);
});

test("free games have no deal score", () => {
  assert.equal(dealScore({ ...base, price: 0, regularPrice: 0, lowest: 0 }), null);
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

test("missing data scores zero, not NaN", () => {
  const g = { ...base, metascore: null, steamPct: null, recentPct: null, recentReviews: 0, launchPct: null, launchReviews: 0, hours: null, deck: "unknown" };
  for (const s of [worthScore(g, now), dealScore(g), dadScore(g), multiplayerScore({ ...g, onlinePvp: true }, now)]) {
    assert.ok(Number.isFinite(s.score));
  }
});

test("typical price is where the game sat for at least half the time", () => {
  const t0 = Date.parse("2026-08-01");
  // $20 for 40 days, $5 for 10 days, $20 for 10 days → typically $20
  const pts = [[t0, 20], [t0 + 40 * DAY, 5], [t0 + 50 * DAY, 20]];
  assert.equal(typicalPrice(pts, t0 + 60 * DAY), 20);
  assert.equal(typicalPrice(pts, t0 + 20 * DAY), null); // under 30 days
});

test("patient games are a year old and finished", () => {
  assert.ok(isPatient(base, now));
  assert.ok(!isPatient({ ...base, released: "2026-01-01" }, now));
  assert.ok(!isPatient({ ...base, earlyAccess: true }, now));
  assert.ok(!isPatient({ ...base, liveService: true }, now));
});

test("age in months", () => assert.equal(ageMonths(base, now), 45));

test("every fetched game has the fields the scores need", () => {
  const { games } = JSON.parse(readFileSync(new URL("./games.json", import.meta.url)));
  assert.ok(games.length > 0);
  for (const g of games) {
    for (const k of ["appid", "title", "released", "price", "deck", "controller"]) assert.ok(g[k] != null, `${g.title}: ${k}`);
    assert.match(g.released, /^\d{4}-\d{2}-\d{2}$/, g.title);
  }
});
