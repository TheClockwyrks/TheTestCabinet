// Wick — instrumentation/set-hp-off-a-run-screen-applies: setHp(10) issued on
// `title` sets the health there.
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
// the run is a field of the state on every screen, so the health the call names
// has a defined value to reach whatever is showing.

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

it("applies the health the call named, from the title", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the call is made on");

  h.debug.setHp(10);
  h.debug.reconcile();
  const after = h.snapshot();
  assertEqual(after.run.player.hp, 10, "the health the call set");
  assertEqual(after.screen, "title", "the screen the call left");

  await h.frameDraw();
  captureStill(h, "posed");
});
