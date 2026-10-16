import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { patientScore, dadScore, ageMonths } from "./score.js";

const now = new Date("2026-10-01");
const base = { released: "2023-01-15", meta: 90, user: 9.0, price: 10, hours: 10, complete: true, bursts: true, handheld: true, liveService: false };

test("ideal game maxes both scores", () => {
  assert.equal(patientScore(base, now).score, 92);
  assert.equal(dadScore(base).score, 96);
});

test("brand-new full-price live service scores low", () => {
  const g = { ...base, released: "2026-09-01", price: 70, complete: false, liveService: true };
  assert.ok(patientScore(g, now).score < 10);
});

test("long games lose finishability points", () => {
  assert.ok(dadScore({ ...base, hours: 80 }).score < dadScore(base).score - 30);
});

test("age in months", () => assert.equal(ageMonths(base, now), 45));

test("every bundled game has the fields the scores need", () => {
  for (const g of JSON.parse(readFileSync(new URL("./games.json", import.meta.url)))) {
    for (const k of ["title", "released", "platforms", "meta", "price", "hours"]) assert.ok(g[k] != null, `${g.title}: ${k}`);
    assert.match(g.released, /^\d{4}-\d{2}$/, g.title);
  }
});
