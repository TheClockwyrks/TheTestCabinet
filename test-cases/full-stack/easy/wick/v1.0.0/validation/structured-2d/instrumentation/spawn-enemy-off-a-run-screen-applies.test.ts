// Wick — instrumentation/spawn-enemy-off-a-run-screen-applies:
// spawnEnemy('moth', 0, 0) issued on `title` puts the moth on the field.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "The
// operations"): "No operation asks how the caller got to it. The screen
// showing, the overlay open, and what a player would have had to do first are
// the route a player takes and are not an operation's conditions, so every
// operation below acts on the game from wherever it stands: `setHp` sets the
// health on `title` as readily as on `playing`, and `spawnEnemy` puts an enemy
// on the field whatever screen is up. What no operation does is refuse quietly,
// returning with the state as it was." Every other operation the rule covers is
// a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. The title is the screen a reset leaves, and
// its idle run holds no enemy, so the one the snapshot reports afterwards is
// the one the call put there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the enemy the call named, from the title", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the call is made on");

  h.debug.spawnEnemy("moth", 0, 0);
  h.debug.reconcile();
  const after = h.snapshot();
  assertEqual(after.run.enemies.length, 1, "how many enemies the field holds");
  assertEqual(after.run.enemies[0]?.type, "moth", "the spawned enemy's type");
  assertEqual(after.screen, "title", "the screen the call left");

  await h.frameDraw();
  captureStill(h, "posed");
});
