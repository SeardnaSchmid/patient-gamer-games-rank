import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patientScore, dadScore, ageMonths, quality } from "./score.js";

const now = new Date("2026-10-01");
const base = {
  title: "Game: Complete Edition", released: "2023-01-15", metascore: 90, steamPct: 95, price: 10, lowest: 10,
  hours: 10, deck: "verified", controller: "full", cloud: true, saveAnytime: true, liveService: false,
};

test("ideal game maxes both scores", () => {
  assert.equal(patientScore(base, now).score, 98); // quality 92.5 → 23.2 of 25
  assert.equal(dadScore(base).score, 98);
});

test("full price far above the all-time low loses the deal points", () => {
  const p = patientScore({ ...base, price: 40, lowest: 10 }, now).parts;
  assert.equal(p["Near all-time low"][0], 0);
  assert.equal(p.Price[0], 0);
});

test("brand-new live service scores low", () => {
  const g = { ...base, title: "Game", released: "2026-09-01", price: 70, lowest: 70, liveService: true };
  assert.ok(patientScore(g, now).score < 30);
});

test("missing data scores zero, not NaN", () => {
  const g = { ...base, metascore: null, steamPct: null, hours: null, deck: "unknown" };
  assert.equal(quality(g), null);
  assert.ok(Number.isFinite(dadScore(g).score) && Number.isFinite(patientScore(g, now).score));
});

test("age in months", () => assert.equal(ageMonths(base, now), 45));

test("every fetched game has the fields the scores need", () => {
  const { games } = JSON.parse(readFileSync(new URL("./games.json", import.meta.url)));
  assert.ok(games.length > 0);
  for (const g of games) {
    for (const k of ["appid", "title", "released", "price", "lowest", "deck", "controller"]) assert.ok(g[k] != null, `${g.title}: ${k}`);
    assert.match(g.released, /^\d{4}-\d{2}-\d{2}$/, g.title);
  }
});
