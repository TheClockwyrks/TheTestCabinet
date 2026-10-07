// passives/bellows-speed-mul — Bellows multiplies the lamplighter's move speed
// by `1 + BELLOWS_SPEED_PER_LEVEL` per level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `BELLOWS_SPEED_PER_LEVEL` is `0.1`, and
// "speedMul = 1 + BELLOWS_SPEED_PER_LEVEL × bellows", so Bellows 2 is `1.2`.
// The Move speed section applies it: "The lamplighter's move speed is
// `MOVE_SPEED` (`180`) times `speedMul`, in units per second", so `moveSpeed`
// reads `216`. `specs/world.md` (Movement) integrates it: "The velocity is
// that direction times `moveSpeed`, and each tick the position advances by the
// velocity times `TICK_DT`", so a tick of held `right` moves the lamplighter
// `216 / 60 = 3.6` units.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Bellows 2 and
// nothing else, with every driver switch off, so nothing but the held key
// moves the lamplighter. `ArrowRight` carries the `right` action
// (`specs/controls.md`), read "as a held value on the `playing` screen"
// (`specs/world.md`, Movement), and the hold is sampled a tick at a time so
// every tick of the second is held to the step rather than the total alone.
//
// THE TOLERANCE. `REAL_EPS` on `moveSpeed`, one constant times one multiplier,
// and `MOTION_EPS` on each tick's step and on the second's total, an
// integration; the unscaled step, `3`, is six tenths of a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  MOTION_EPS,
  REAL_EPS,
  TICK_DT,
  TICK_HZ,
  moveSpeedOf,
} from "../constants";
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

/** The step one tick of held `right` makes: `216 / 60 = 3.6`. */
const STEP = SPEED * TICK_DT;

/** One second of game time. */
const HELD_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads moveSpeed 216 under Bellows 2 and moves 3.6 units a tick with ArrowRight held", async () => {
  isolate(h);
  holdPassive(h, "bellows", BELLOWS);
  const armed = h.snapshot();
  assertNear(
    armed.run.moveSpeed,
    SPEED,
    REAL_EPS,
    "run.moveSpeed under Bellows 2 (specs/passives.md, Move speed)",
  );

  const start = armed.run.player;
  const trace = await captureReplay(h, "speed", () =>
    holdSampling(h, ["ArrowRight"], HELD_TICKS),
  );

  let previous = start;
  trace.forEach((s, i) => {
    assertNear(
      s.run.player.x - previous.x,
      STEP,
      MOTION_EPS,
      `the step in player.x on tick ${i + 1} of the hold (specs/world.md, Movement)`,
    );
    assertNear(
      s.run.player.y - previous.y,
      0,
      MOTION_EPS,
      `the step in player.y on tick ${i + 1} of the hold (specs/world.md, Movement)`,
    );
    previous = s.run.player;
  });
  assertNear(
    trace[trace.length - 1].run.player.x - start.x,
    SPEED,
    MOTION_EPS,
    "the distance walked over one held second under Bellows 2 (specs/passives.md, Move speed)",
  );
});
