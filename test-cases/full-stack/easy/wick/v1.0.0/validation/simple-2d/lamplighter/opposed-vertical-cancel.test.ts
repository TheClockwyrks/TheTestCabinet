// lamplighter/opposed-vertical-cancel — up and down held together cancel.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Movement"): "The movement
// direction is the sum of the unit vectors of the held actions, up (0, -1),
// down (0, 1) ... normalized to unit length when the sum is non-zero", and "two
// opposite actions held together cancel to no movement on that axis." With
// ArrowUp and ArrowDown held together the sum is (0, 0), so no tick moves
// player.y at all.
//
// THE WORLD. An isolated playing run (`isolate`): nothing on the field, no
// weapon held, every driver switch off, so the two held keys are the only thing
// that could move the lamplighter, which stands at the origin.
//
// WHAT IS READ, AND IN WHICH DIRECTION. player.y on every one of HELD_TICKS
// held ticks, against the value it started with. This point decides the
// vertical pair alone; the horizontal pair is `opposed-horizontal-cancel`.
//
// TOLERANCE. MOTION_TOLERANCE (1e-6), the case's tolerance for a position
// integrated tick by tick. A cancelled axis adds 0 × moveSpeed × TICK_DT, which
// is exact, and a build whose zero vector still normalized to something would
// move a whole step of 3 units a tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import { BINDINGS, MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The first keys specs/controls.md binds to `up` and `down`. */
const KEYS = [BINDINGS.up[0], BINDINGS.down[0]];

/** Ticks the pair is held: half a second. */
const HELD_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds player.y still while ArrowUp and ArrowDown are held together", async () => {
  const posed = isolate(h);
  assertEqual(posed.screen, "playing", "the screen the keys are held on");
  const start = posed.run.player;

  const seen = await captureReplay(h, "cancel", async () => {
    for (const key of KEYS) h.holdKey(key);
    try {
      return await h.trace(HELD_TICKS);
    } finally {
      for (const key of KEYS) h.releaseKey(key);
    }
  });

  assertLength(seen, HELD_TICKS, "ticks traced under the held keys");
  seen.forEach((snapshot, i) => {
    assertWithin(
      snapshot.run.player.y,
      start.y,
      MOTION_TOLERANCE,
      `player.y on held tick ${i + 1}, against where the hold began`,
    );
  });
});
