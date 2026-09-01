// Wick — instrumentation/remove-enemy: `removeEnemy(id)` on a moth leaves that
// moth gone and every other enemy present, with `kills` unchanged, no gem or
// pickup dropped, and no cue played.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `removeEnemy(id)`): "Removes enemy `id`. Nothing drops, nothing counts as a
// kill, and no cue plays."
//
// WHY THE WORLD IS POSED AS IT IS. Two moths, one removed, so the other must
// stay; the kill count is posed to a figure that is not `0` so a count that
// rose is plain; the sounds emitted across the call are read off the probe
// inside the page, in the same evaluation as the call, because the same
// document leaves the build's own loop running in real time while the clock is
// held and a frame of that loop reconciles the looping cues.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  bracket,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_KILLS = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await h.armAudio();
});

afterEach(async () => {
  await h.dispose();
});

it("removes one enemy with no outcome", async () => {
  await isolate(h);
  await h.debug.setKills(POSED_KILLS);
  const removed = await placeEnemy(h, "moth", 200, 0);
  const kept = await placeEnemy(h, "moth", -200, 0);

  const { after, sounds } = await bracket(h, "removeEnemy", [removed.id]);
  await captureStill(h, "removed");

  assertEqual(enemyById(after, removed.id), undefined, "the removed moth");
  assertEqual(enemyById(after, kept.id) !== undefined, true, "the other moth, still present");
  assertLength(after.run.enemies, 1, "the enemies after the removal");
  assertEqual(after.run.kills, POSED_KILLS, "kills across the removal");
  assertLength(after.run.gems, 0, "gems dropped by the removal");
  assertLength(after.run.pickups, 0, "pickups dropped by the removal");
  assertLength(sounds, 0, "sounds played at the removal");
});
