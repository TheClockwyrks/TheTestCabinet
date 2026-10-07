// Wick — enemies/age-counts-per-tick: an enemy's age rises by TICK_DT on every
// tick it is alive for.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("The life of an enemy"):
// "It spawns ... with `age` `0` ... `age` is the seconds since it spawned:
// every tick adds `TICK_DT` (`1 / 60`) to it", and "an enemy spawned on a tick
// sits at its spawn point for that tick and first moves on the next".
// `specs/world.md` ("One tick") puts the counting in phase 4, "Every enemy ages
// by `TICK_DT`", ahead of the movement the same phase gates, and
// `specs/instrumentation.md` says the counting is not gated at all: with
// `enemyMotion` off "Every enemy holds its position and heading. `age` and
// `contactCooldown` still count." So 30 ticks leave `age` at `30 / 60` = `0.5`
// whether or not anything moved.
//
// THE POSE. An isolated night holding nothing but the lamplighter and one moth
// 300 units along `+x`, every faculty held: `enemyMotion` so the age is read
// clear of the movement, and the rest so no director spawn, no touch and no
// removal reads into it. The age is read off the spawn, then 30 ticks are run
// and read again.
//
// TOLERANCE. `TIMER_TOL` on the age, a sum of 30 additions of `TICK_DT`
// (`1/60`, inexact in binary), far inside the sixtieth of a second one tick of
// the count is worth.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { TICK_DT, TIMER_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  type Harness,
} from "../harness";

/** The ticks run after the spawn: half a second of counting. */
const TICKS = 30;

/** How far out the moth stands: clear of everything. */
const GAP = 300;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads a moth's age 0 at spawn and 30 / 60 after 30 ticks", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", GAP, 0);

  const after = await h.step(TICKS);
  await captureStill(h, "age");

  assertNear(moth.age, 0, TIMER_TOL, "the moth's age on its spawn tick");
  assertNear(
    mustEnemy(after, moth.id).age,
    TICKS * TICK_DT,
    TIMER_TOL,
    "the moth's age after 30 ticks",
  );
});
