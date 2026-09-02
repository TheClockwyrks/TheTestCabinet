// lamplighter/facing-holds-on-vertical — a lamplighter walking straight up
// keeps its facing.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Facing"): "A tick with no
// horizontal component, whether the lamplighter is still or moving straight up
// or down, leaves `facing` as it was." With `up` alone held the movement
// direction is `(0, -1)`, whose horizontal component is zero, so every tick of
// the hold leaves `facing` where it stood. The posed value is `"left"`, the
// one a fresh run does not start with, so a build that derives facing from the
// sign of a zero component, or resets it on movement, is caught rather than
// agreed with. The figure is a string the specification fixes exactly, so there
// is no tolerance to state.
//
// THE NIGHT. An isolated run (`isolate`): the lamplighter alone at the origin,
// every driver switch off, nothing alive, and the level out of reach. `facing`
// is posed to `"left"` through the surface, and ArrowUp is a real key event
// held for `HOLD_TICKS` (`60`) ticks, a second of walking straight up.
//
// WHAT IS READ. `facing` on every tick of the hold, and, so that the second
// was the vertical walk the point is about rather than a second of standing
// still, that `player.y` fell over it. How far it fell is `move-up`'s and
// `move-speed`'s business.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  isolate,
  player,
  type Harness,
} from "../harness";

/** One second of the hold, read one tick at a time. */
const HOLD_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps facing left across a second of ArrowUp alone held", async () => {
  const opened = await isolate(h);
  await h.debug.setFacing("left");
  const posed = await h.snapshot();
  assertEqual(player(posed).facing, "left", "facing as posed");

  const ticks = await captureReplay(h, "vertical", () =>
    holdKeysWatching(h, ["ArrowUp"], HOLD_TICKS),
  );

  assertEqual(ticks.length, HOLD_TICKS, "the frames the hold ran");
  ticks.forEach((snapshot, i) => {
    assertEqual(
      snapshot.screen,
      "playing",
      `the screen on tick ${i + 1} of the ArrowUp hold`,
    );
    assertEqual(
      player(snapshot).facing,
      "left",
      `facing on tick ${i + 1} of the ArrowUp hold`,
    );
  });
  assertLessThan(
    player(ticks[HOLD_TICKS - 1]!).y,
    player(opened).y,
    "player.y after the hold, against before it: the lamplighter walked up",
  );
});
