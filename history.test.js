import { test } from "node:test";
import assert from "node:assert/strict";
import { appendHistory } from "./scripts/history.mjs";

const game = { appid: 1, price: 20, lowest: 10, steamPct: 90, metascore: 85, deck: "verified", steamReviews: 1000 };
const fresh = () => ({ fields: [], games: {} });

test("first day starts a row", () => {
  assert.deepEqual(appendHistory(fresh(), [game], "2026-10-16").games[1], [["2026-10-16", 20, 10, 90, 85, "verified", 1000]]);
});

test("unchanged values add nothing, even if reviews grew", () => {
  const h = appendHistory(fresh(), [game], "2026-10-16");
  appendHistory(h, [{ ...game, steamReviews: 1100 }], "2026-10-17");
  assert.equal(h.games[1].length, 1);
});

test("a price change adds a row", () => {
  const h = appendHistory(fresh(), [game], "2026-10-16");
  appendHistory(h, [{ ...game, price: 5 }], "2026-10-17");
  assert.deepEqual(h.games[1].map((r) => r[1]), [20, 5]);
});

test("a rerun on the same day replaces that day's row", () => {
  const h = appendHistory(fresh(), [game], "2026-10-16");
  appendHistory(h, [{ ...game, price: 5 }], "2026-10-16");
  assert.deepEqual(h.games[1], [["2026-10-16", 5, 10, 90, 85, "verified", 1000]]);
});
