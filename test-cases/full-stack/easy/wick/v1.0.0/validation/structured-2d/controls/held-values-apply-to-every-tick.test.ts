// controls/held-values-apply-to-every-tick — a frame's held values apply to
// every tick it consumes.
//
// WHAT THIS DECIDES. One thing: a movement key held for one frame worth three
// ticks moves the lamplighter on all three, not on the first alone. The
// per-tick distance itself is the lamplighter's business; the accumulator's
// rule that 50 ms is three ticks is the instrumentation's, read back here as
// the precondition.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md ("Moving the lamplighter"): "On `playing`, the four
//   movement actions are read as held values, sampled once per frame and
//   applied to every tick that frame consumes."
//   specs/world.md ("Movement"): "The velocity is that direction times
//   `moveSpeed`, and each tick the position advances by the velocity times
//   `TICK_DT`", with `MOVE_SPEED` 180 and `TICK_DT` 1/60: 3 units a tick, so
//   three ticks are 9.
//   specs/instrumentation.md ("A deterministic core"): "each frame's delta
//   time joins the accumulator, every whole `TICK_DT` in it is consumed as a
//   tick", and "a clock of any other length poses a partial frame".
//
// THE DRIVE. An isolated world with the lamplighter at the origin.
// `ArrowRight` is pressed, ONE frame worth 50 ms is run through the scripted
// clock, and the key is released before any other frame: the frame consumes
// exactly three ticks, so a build that applied the held value to the first
// tick alone reads 3, one that applied it to none reads 0, and only a build
// applying the frame's sample to every tick reads 9.
//
// THE TOLERANCE. `MOTION_EPS`, the suite's bound for a position reached by
// integrating a tick at a time; the nearest wrong answer is 6 units off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, MOVE_SPEED, TICK_DT } from "../constants";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The one frame's delta, in milliseconds: three whole ticks of 1000/60. */
const FRAME_MS = 50;

/** The ticks a 50 ms frame consumes. */
const TICKS = 3;

/** Three ticks of `MOVE_SPEED × TICK_DT`: 9 units. */
const EXPECTED_X = MOVE_SPEED * TICK_DT * TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the lamplighter 9 units over one 50 ms frame with ArrowRight held", async () => {
  const posed = isolate(h);
  assertEqual(posed.run.player.x, 0, "player.x before the frame");
  assertEqual(posed.run.tick, 0, "the run clock before the frame");

  h.holdKey("ArrowRight");
  let after;
  try {
    after = await h.frameOf(FRAME_MS);
  } finally {
    h.releaseKey("ArrowRight");
  }
  captureStill(h, "frame");

  assertEqual(after.run.tick, TICKS, "the ticks the 50 ms frame consumed");
  assertNear(
    after.run.player.x,
    EXPECTED_X,
    MOTION_EPS,
    "player.x after one 50 ms frame with ArrowRight held",
  );
});
