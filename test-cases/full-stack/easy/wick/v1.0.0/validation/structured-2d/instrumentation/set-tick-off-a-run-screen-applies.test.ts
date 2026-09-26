// Wick — instrumentation/set-tick-off-a-run-screen-applies: setTick(100)
// issued on `title` moves the run clock there.
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
// its idle run stands at tick `0`, so the clock the snapshot reports afterwards
// is the one the call posed. `time` is derived from `tick`, so it is read back
// too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TICK_HZ } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the clock the call named, from the title", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the call is made on");

  h.debug.setTick(100);
  h.debug.reconcile();
  const after = h.snapshot();
  assertEqual(after.run.tick, 100, "the run clock the call posed");
  assertEqual(after.run.time, 100 / TICK_HZ, "the seconds derived from it");
  assertEqual(after.screen, "title", "the screen the call left");

  await h.frameDraw();
  captureStill(h, "posed");
});
