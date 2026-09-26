// Wick — sconce/reverses: a sconce turns back after `speed / SCONCE_DECEL`
// seconds of motion.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"): a sconce's
// velocity along `d` "falls under a constant acceleration of `−SCONCE_DECEL`
// (`600`) ... so after `n` moving ticks its velocity is
// `(speed − SCONCE_DECEL × n × TICK_DT) × d`. It reverses once
// `speed / SCONCE_DECEL` seconds of motion have passed". Row 1 of
// `SCONCE_LEVELS` launches at speed `600`, so `600 / 600` = `1` second is
// `round(1 × TICK_HZ)` = `60` moving ticks (`specs/world.md`, "Timers"), and
// the velocity along `d` is `600 − 10n`: still positive on tick `59`
// (`10` units per second), `0` on tick `60`, and negative on tick `61`
// (`-10`). The reading is the sign either side of the turn rather than the
// three magnitudes, because the requirement here is that the sconce reverses
// and when, not the rate it slows at.
//
// WHY THE WORLD IS POSED AS IT IS. The requirement is one shape's turn, so the
// night holds one sconce and nothing else — no enemy, no weapon held — and
// `effectMotion` alone is turned back on, so the `61` ticks stepped are `61`
// moving ticks. The sconce is posed rather than launched because
// `spawnProjectile` gives it the launch's own acceleration ("A `sconce` takes
// acceleration `−SCONCE_DECEL` along the unit vector of `(vx, vy)`",
// `specs/instrumentation.md`) and a posed launch takes no enemy to aim at; its
// direction is `+x`, so the component along `d` is read straight off `vx`. Its
// ttl is row 1's `2.5` seconds, `150` ticks, so it is alive across the turn.
//
// TOLERANCE. The two signs are exact: the specification puts the velocity `10`
// units per second either side of the turn, so a build that reverses one tick
// early or late reads `0` or `-10` where a `10` is asserted. `POSITION_TOL` on
// the `0` of tick `60`, a figure reached by adding `SCONCE_DECEL × TICK_DT`
// sixty times, whose drift is of order `1e-13`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, assertNear } from "../assert";
import { POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  isolate,
  mustProjectile,
  type Harness,
} from "../harness";
import { CENTER, LAUNCH_LINE, along, placeSconce } from "./stage";

/** The tick the turn falls on: `speed / SCONCE_DECEL` = `1` second of motion. */
const TURN = 60;

/** The moving ticks stepped: one past the turn. */
const TICKS = TURN + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a level-1 sconce moving out on tick 59, still on tick 60, and back on tick 61", async () => {
  await isolate(h);
  const posed = await placeSconce(h, CENTER, LAUNCH_LINE);
  await enable(h, "effectMotion");

  const ticks = await captureReplay(h, "reversal", () => h.stepWatching(TICKS));
  const speedOn = (tick: number): number => {
    const sconce = mustProjectile(ticks[tick - 1]!, posed.id);
    return along({ x: sconce.vx, y: sconce.vy }, LAUNCH_LINE);
  };

  assertGreaterThan(
    speedOn(TURN - 1),
    0,
    "the sconce's speed along its launch direction on moving tick 59",
  );
  assertNear(
    speedOn(TURN),
    0,
    POSITION_TOL,
    "the sconce's speed along its launch direction on moving tick 60",
  );
  assertLessThan(
    speedOn(TURN + 1),
    0,
    "the sconce's speed along its launch direction on moving tick 61",
  );
});
