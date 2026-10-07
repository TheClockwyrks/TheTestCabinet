// passives/bellows-diagonal-equals-cardinal — the diagonal is as fast as a
// cardinal at every Bellows level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Move speed: "The
// lamplighter's move speed is `MOVE_SPEED` (`180`) times `speedMul` ... and
// the movement rule in `specs/world.md` integrates that speed each tick.
// Diagonal speed equals cardinal speed at every Bellows level." `speedMul` is
// `1 + 0.1 × bellows`, so `moveSpeed` is `216` at Bellows 2 and a tick's step
// is `216 / 60 = 3.6` units. `specs/world.md` (Movement) fixes the direction:
// "The movement direction is the sum of the unit vectors of the held actions,
// ... `down` `(0, 1)`, ... and `right` `(1, 0)`, normalized to unit length
// when the sum is non-zero", so the step is `3.6` along `(1, 1) / √2`, which
// is `3.6 / √2` on each axis and not `3.6` on each.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Bellows 2 and
// nothing else, with every driver switch off, so nothing but the two held keys
// moves the lamplighter. `ArrowRight` and `ArrowDown` carry `right` and `down`
// (`specs/controls.md`) and are both down before the first frame, so every
// sampled tick is a diagonal tick.
//
// THE TOLERANCE. `MOTION_EPS` on each axis of every step and on the second's
// total displacement, an integration; a build that skipped the normalization
// would overshoot each axis by `1.05` units a tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS, TICK_DT, TICK_HZ, moveSpeedOf } from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  holdSampling,
  isolate,
  type Harness,
} from "../harness";

/** The Bellows level held: `speedMul` `1.2`. */
const BELLOWS = 2;

/** The move speed `MOVE_SPEED` becomes under Bellows 2: `216`. */
const SPEED = moveSpeedOf(BELLOWS);

/** The step one diagonal tick makes: `3.6` units along `(1, 1) / √2`. */
const STEP = SPEED * TICK_DT;

/** Each axis's share of that step. */
const AXIS_STEP = STEP * Math.SQRT1_2;

/** One second of game time. */
const HELD_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves 3.6 units a tick along the diagonal under Bellows 2", async () => {
  isolate(h);
  holdPassive(h, "bellows", BELLOWS);
  const start = h.snapshot().run.player;

  const trace = await captureReplay(h, "diagonal", () =>
    holdSampling(h, ["ArrowRight", "ArrowDown"], HELD_TICKS),
  );

  let previous = start;
  trace.forEach((s, i) => {
    assertNear(
      Math.hypot(s.run.player.x - previous.x, s.run.player.y - previous.y),
      STEP,
      MOTION_EPS,
      `the distance moved on tick ${i + 1} of the diagonal hold (specs/passives.md, Move speed)`,
    );
    assertNear(
      s.run.player.x - previous.x,
      AXIS_STEP,
      MOTION_EPS,
      `the step in player.x on tick ${i + 1} of the diagonal hold (specs/world.md, Movement)`,
    );
    assertNear(
      s.run.player.y - previous.y,
      AXIS_STEP,
      MOTION_EPS,
      `the step in player.y on tick ${i + 1} of the diagonal hold (specs/world.md, Movement)`,
    );
    previous = s.run.player;
  });
  const last = trace[trace.length - 1].run.player;
  assertNear(
    Math.hypot(last.x - start.x, last.y - start.y),
    SPEED,
    MOTION_EPS,
    "the distance moved along the diagonal over one held second under Bellows 2 (specs/passives.md, Move speed)",
  );
});
