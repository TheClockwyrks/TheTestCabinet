// Wick — passives/tinder-recovery-per-tick: Tinder recovers `0.5` health per
// second per level, applied on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("The derived stats"):
// "`recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder`" with
// `BASE_RECOVERY` (`0`) and `TINDER_RECOVERY_PER_LEVEL` (`0.5`), and
// ("Recovery") "On every tick of the `playing` screen: `hp = min(maxHp, hp +
// recovery × TICK_DT)` with `TICK_DT` (`1/60`) seconds. Recovery is continuous
// rather than periodic." At Tinder 2 `recovery` is `1` health per second, so
// from a posed `hp` of `50` one tick reads `50 + 1/60` and `TICK_HZ` (`60`)
// ticks read `51`, well under the `maxHp` of `100` a run with no Tallow holds.
//
// THE POSE. An isolated night with Tinder 2 held through `setPassive` and `hp`
// posed to `START` (`50`) through `setHp`, then one second driven a tick at a
// time. Every faculty stays held, nothing is alive to hit back, and no heal is
// collected, so recovery is the only thing that moves `hp`.
//
// TOLERANCE. `FLOAT_TOL` (`1e-9`) on both readings: a build that adds an
// inexact `1/60` sixty times drifts by a few `1e-15`, six orders inside it. A
// build that recovered once a second reads `50` on the first tick, a sixtieth
// of a unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, TICK_DT, TICK_HZ, recoveryOf } from "../constants";
import {
  captureReplay,
  createHarness,
  holdPassive,
  isolate,
  player,
  type Harness,
} from "../harness";

/** The Tinder level held: `recovery` `1` health per second. */
const TINDER_LEVEL = 2;

/** The health the run is posed at, well under the maximum. */
const START = 50;

/** One second of game time. */
const DRIVE = TICK_HZ;

/** `0.5 × 2`. */
const RECOVERY = recoveryOf({ tinder: TINDER_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads hp 50 + 1/60 after one tick and 51 after sixty with Tinder 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "tinder", TINDER_LEVEL);
  await h.debug.setHp(START);

  const ticks = await captureReplay(h, "recovery", () => h.stepWatching(DRIVE));

  assertEqual(ticks.length, DRIVE, "the ticks the drive ran");
  assertNear(
    player(ticks[0]!).hp,
    START + RECOVERY * TICK_DT,
    FLOAT_TOL,
    "hp after one tick of recovery at Tinder 2",
  );
  assertNear(
    player(ticks[DRIVE - 1]!).hp,
    START + RECOVERY,
    FLOAT_TOL,
    "hp after one second of recovery at Tinder 2",
  );
});
