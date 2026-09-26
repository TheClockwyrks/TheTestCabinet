// progression/feed-speed-table — each level runs at its own feed speed.
//
// THE SPEC LINE. `specs/progression.md` — "Levels" fixes one feed speed per
// level:
//
//   | Level | Feed speed (units/s) |
//   | 1 | 22 |  | 2 | 26 |  | 3 | 30 |  | 4 | 34 |  | 5 | 38 |
//
// "The feed speed is the level's base rate for the lead segment, before pressure
// and machinery scale it", and `specs/channel.md` says what the lead segment does
// with it: "The lead segment | the effective feed speed", where "effective feed
// speed = level feed speed x (1 + pressure / 100) x choke factor". At pressure 0
// with no choke both factors are 1, so the lead segment gains the level's own
// figure every second.
//
// THE DRIVE. Per level: open it, hold the inlet so it places nothing,
// empty the channel, and pose ONE core. A lone core is the head, so it is the
// lead segment ("the lead segment is the one containing the head"), and it is the
// only segment, so no merge and no clamp can touch the measurement. Sixty ticks
// is exactly one second of simulated time (`TICK_HZ` 60), so the arc the core
// gains over them is the speed in units per second, read in the same units the
// table states.
//
// WHERE THE CORE IS POSED. `s = 1000`, which is well clear of both ends: the
// inlet is at 0 and the intake at 5000, so nothing the run gains in a second
// brings it near either, and the danger threshold at 4000 is far off.
//
// TOLERANCE. The case's standing tolerance for a speed measured over at least 30
// ticks, +/- 2% of the stated figure (`SPEED_TOL_FRACTION`), applied to the
// one-second gain — which is numerically the same quantity. That is 0.44 units at
// level 1 and 0.76 at level 5: wide enough for any legal per-tick integration of
// `rate x dt` and for the order a build advances its segments in, and far tighter
// than the 4 units that separate one row of the table from the next, so a build
// carrying the wrong row fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { LEVELS, TICK_HZ, speedTolerance } from "../constants";
import {
  captureReplay,
  createHarness,
  head,
  poseHall,
  type Harness,
} from "../harness";

/** One second of simulated time, which is what makes a gain a speed. */
const TICKS = TICK_HZ;

/** Mid-channel, clear of the inlet, the intake and the danger threshold. */
const POSED_S = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("advances the lead segment at each level's own feed speed", async () => {
  const gains: number[] = [];

  // The recorder is armed around the whole sweep. The poses between the drives
  // close no frame, so what the recording holds is the five seconds of riding.
  await captureReplay(h, "speeds", async () => {
    for (const level of LEVELS) {
      await poseHall(h, {
        level: level.level,
        pressure: 0,
        cores: [[POSED_S, "halide", null]],
      });
      const from = head(await h.snapshot()).s;
      const after = await h.step(TICKS);
      gains.push(head(after).s - from);
    }
  });

  LEVELS.forEach((level, index) => {
    assertNear(
      gains[index],
      level.feed,
      speedTolerance(level.feed),
      `the arc the lead segment gained in one second on level ${level.level}`,
    );
  });
});
