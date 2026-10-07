// Wick — instrumentation/set-kills: `setKills(250)` reads back `kills` 250, and
// the next kill reads 251.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setKills(kills)`):
// "Sets `kills` to `kills`, a whole number of at least `0`." specs/weapons.md —
// "Hits and death": "On any tick an enemy's `hp` is at or below `0` after the
// hits the enemy dies on that tick: the kill count rises by one".
//
// WHY THE WORLD IS POSED AS IT IS. A moth (5 hp) is posed under a posed Ember
// bolt (10 damage per hit at level 1 with no Wick), so the next tick's hits
// kill it and the count must read one more than the posed figure. Every
// faculty is held; a still bolt hits where it stands, "a new one hitting at
// the position it was created at".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

const POSED_KILLS = 250;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the kill count, and the next kill counts from it", async () => {
  await isolate(h);
  await h.debug.setKills(POSED_KILLS);
  const posed = await h.snapshot();
  await captureStill(h, "posed");
  assertEqual(posed.run.kills, POSED_KILLS, "kills after setKills(250)");

  await placeEnemy(h, "moth", 30, 0);
  await placeProjectile(h, "ember", 30, 0, 0, 0, 0);
  const killed = await h.step(1);
  assertLength(killed.run.enemies, 0, "the moth after the bolt's hit");
  assertEqual(killed.run.kills, POSED_KILLS + 1, "kills after the next kill");
});
