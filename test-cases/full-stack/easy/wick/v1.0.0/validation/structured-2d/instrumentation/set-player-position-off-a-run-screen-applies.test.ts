// Wick — instrumentation/set-player-position-off-a-run-screen-applies:
// setPlayerPosition(5, 5) issued on `levelup` moves the lamplighter there.
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
// WHY THE WORLD IS POSED AS IT IS. The level-up overlay is reached the way a
// gain reaches it, so the run standing under it is a real one; the overlay is
// exactly the screen a player could not move on, which is what makes it the
// screen worth calling from.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("applies the position the call named, from the overlay", async () => {
  isolate(h);
  const before = await openLevelUp(h, 1);
  assertEqual(before.screen, "levelup", "the screen the call is made on");

  h.debug.setPlayerPosition(5, 5);
  h.debug.reconcile();
  const after = h.snapshot();
  assertEqual(after.run.player.x, 5, "the lamplighter's x");
  assertEqual(after.run.player.y, 5, "the lamplighter's y");
  assertEqual(after.screen, "levelup", "the screen the call left");

  await h.frameDraw();
  captureStill(h, "posed");
});
