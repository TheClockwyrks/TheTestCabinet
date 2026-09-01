// controls/held-until-every-key-released — an action stays held while any of
// its keys is down.
//
// WHAT THIS DECIDES. One thing: an action bound to two keys is held for as
// long as EITHER key is down, so releasing one of two held keys leaves the
// lamplighter moving and releasing the other stops it. That each key moves
// the lamplighter on its own is lamplighter/move-up and
// lamplighter/key-w-moves-like-arrow-up; this point is the release order.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Actions and bindings"): "`up` | `ArrowUp`, `KeyW` |
//   held on `playing` ... moves the lamplighter up", and "The two keys bound
//   to an action are interchangeable".
//   The engine's input documentation, which specs/controls.md defers to: a
//   digital action's value "reports `0` or `1`" and "a held key gives it full
//   deflection", so the action stays at `1` while a bound key is down;
//   "Pressing a second key bound to an already-held action is not a new
//   press."
//   specs/world.md ("Movement"): `up` is `(0, -1)`, "The velocity is that
//   direction times `moveSpeed`, and each tick the position advances by the
//   velocity times `TICK_DT`", so `y` falls 3 units on every held tick and
//   holds still on every tick with no action held.
//
// THE DRIVE. An isolated run (`isolate`: the empty night, every driver switch
// off). `ArrowUp` and `KeyW` both go down and a few frames run so the
// lamplighter is demonstrably moving. `KeyW` is released, `y` is read, 30 more
// frames run, and `y` is read again: the travel across those frames is the
// first verdict. Then `ArrowUp` is released, `y` is read, 30 more frames run,
// and `y` is read once more: the travel across those, which must be none, is
// the second. Each release is dispatched at the engine's own event target
// before the frames it applies to, so the value the next frame samples is the
// one the release left.
//
// THE TOLERANCES.
//   MOVED_MIN, 1 unit of upward travel over the 30 frames after `KeyW` is
//   released. The ideal is 30 × 180 / 60 = 90 units, and the bound is far
//   below it on purpose: it establishes that the action was still HELD, and
//   the rate is lamplighter/move-speed's to grade. One tick is 3 units, so a
//   build that dropped the action on `KeyW`'s release moves 0 and fails.
//   MOTION_TOLERANCE (1e-6 units, constants.ts) on the travel after
//   `ArrowUp` is released, a figure the spec fixes at exactly zero; one
//   leaked tick is 3 units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** Frames both keys are held before the first release, so the walk is under way. */
const LEAD_FRAMES = 10;

/** Frames run after each release: the case's minimum span for a movement reading. */
const WINDOW_FRAMES = 30;

/** How far up the lamplighter must at least travel while `ArrowUp` alone is down. */
const MOVED_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the lamplighter moving up after KeyW is released and stops it once ArrowUp is too", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the keys are held on");

  const walk = await captureReplay(h, "held", async () => {
    h.holdKey("ArrowUp");
    h.holdKey("KeyW");
    try {
      await h.tick(LEAD_FRAMES);
    } finally {
      h.releaseKey("KeyW");
    }
    const oneDown = h.snapshot();
    let oneHeld;
    try {
      oneHeld = await h.tick(WINDOW_FRAMES);
    } finally {
      h.releaseKey("ArrowUp");
    }
    const noneDown = h.snapshot();
    const noneHeld = await h.tick(WINDOW_FRAMES);
    return { oneDown, oneHeld, noneDown, noneHeld };
  });

  assertEqual(
    walk.noneHeld.screen,
    "playing",
    "the screen the walk was driven on",
  );
  assertGreaterThanOrEqual(
    walk.oneDown.run.player.y - walk.oneHeld.run.player.y,
    MOVED_MIN,
    `units travelled up over ${WINDOW_FRAMES} frames after KeyW was released with ArrowUp still down`,
  );
  assertWithin(
    walk.noneHeld.run.player.y,
    walk.noneDown.run.player.y,
    MOTION_TOLERANCE,
    `player.y after ${WINDOW_FRAMES} frames with both keys released`,
  );
});
