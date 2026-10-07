// sconce/reverses — a sconce reverses after speed / SCONCE_DECEL seconds of
// motion.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): "It reverses
// once `speed / SCONCE_DECEL` seconds of motion have passed". With level 1's
// `speed` of 600 and `SCONCE_DECEL` (`600`) that is 1 second, which is
// `round(1 × 60)` = 60 ticks (`specs/world.md`, Timers). The same section's
// "after `n` moving ticks its velocity is `(speed − SCONCE_DECEL × n ×
// TICK_DT) × d`" gives the component along `d` on the three ticks the
// reversal sits between: `600 − 10 × 59` = 10 on tick 59, `600 − 10 × 60` = 0
// on tick 60, and `600 − 10 × 61` = −10 on tick 61. Positive, then nothing,
// then heading back.
//
// WHY THE COMPONENT ALONG `d` AND NOT THE SPEED. The magnitude of the velocity
// is 10 on both tick 59 and tick 61, so a build that turned the sconce around
// early or late reads the same speed on both; the signed component along the
// launch direction is what the reversal changes.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding one posed sconce
// and nothing else, with `effectMotion` on so "the sconces decelerate"
// (`specs/world.md`, phase 6) and every other switch off, so nothing hits it,
// nothing else fires, and no passive scales a figure. 61 ticks is well short
// of the posed sconce's `ttl` of 2.5 seconds, 150 ticks, so it is in the world
// for every reading. Where the launch direction comes from is
// `launch-direction`'s point; here it is given.
//
// THE TOLERANCE. `MOTION_EPS` on each component: 61 additions of a constant
// times `TICK_DT`, each rounding by an ulp, which is why the tick-60 reading
// is held near 0 rather than tested for a sign. A sconce that never reversed
// reads 10 rather than −10 on tick 61, 20 units per second away; one that
// reversed a tick early or late is 10 away on two of the three readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { LAUNCH_DIRECTION } from "./firing";
import {
  along,
  placeSconce,
  poseFlight,
  REVERSAL_TICK,
  speedAfter,
  traceSconce,
} from "./flight";

/** The three ticks the reversal sits between: 59, 60, and 61. */
const TICKS: readonly number[] = [
  REVERSAL_TICK - 1,
  REVERSAL_TICK,
  REVERSAL_TICK + 1,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("carries the sconce along d at 10, then 0, then −10 on ticks 59, 60, and 61", async () => {
  poseFlight(h);
  const id = placeSconce(h, 0, 0, LAUNCH_DIRECTION);

  const trace = await captureReplay(h, "reversal", () =>
    traceSconce(h, id, TICKS[TICKS.length - 1]),
  );

  for (const tick of TICKS) {
    const sconce = trace[tick - 1];
    assertNear(
      along(sconce.vx, sconce.vy, LAUNCH_DIRECTION),
      speedAfter(tick),
      MOTION_EPS,
      `the sconce's velocity along d after ${tick} moving ticks, against speed − SCONCE_DECEL × n × TICK_DT (specs/weapons.md, Sconce)`,
    );
  }
});
