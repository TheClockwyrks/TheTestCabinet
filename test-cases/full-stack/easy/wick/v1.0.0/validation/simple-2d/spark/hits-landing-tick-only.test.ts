// Wick — spark/hits-landing-tick-only: a strike has a hitbox on the tick it
// lands and on no other.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "A strike deals `damage` to its target and
//     to every other enemy within `area` of the target's center, on the tick
//     it lands", and "The strike is drawn for `SPARK_FLASH` (`0.2`) seconds
//     and has no hitbox after the tick it lands."
//   - `specs/state.md` (`ZoneState`, `ttl`): a strike is "drawn for that long
//     and dealing its damage on the tick it appears alone."
//   - `specs/instrumentation.md` (`setEnemyPosition`): "Moves enemy `id` to
//     `(x, y)`; its heading, age, and health are untouched."
//   - `specs/weapons.md` ("Cooldown timers"): after the firing the timer is
//     set to `2.0`, so Spark fires again no sooner than 120 ticks later and
//     the tick after the landing has no new strike.
//
// WHAT IS READ. A moth standing at `700`, beyond the range and beyond any
// area of the target at `150`, on the landing tick, so the strike lands on
// the target alone. That moth is then moved onto the strike's center and one
// more tick runs. The moth is still standing with its hp exactly as it was:
// the strike that landed a tick ago dealt nothing to it.
//
// WHY THE NIGHT IS POSED AS IT IS. Two moths and Spark alone at level 1,
// every switch off but `weaponFire`, so the strike is the only thing that can
// change a moth and a moth holds wherever it is posed. The landing is read on
// its tick, a strike centered on the target, so the second tick is known to
// follow a real landing and not a tick nothing landed on.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the strike's center against the target's
// posed center. None on the moved moth's hp, untouched and read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SPARK_RANGE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  armSpark,
  assertUnhurt,
  sparkRow,
  strikesIn,
  strikesOn,
} from "./strike";

/** The level held: amount 1. */
const LEVEL = 1;

/** Where the target stands: within range, along +x. */
const TARGET_DX = 150;

/** Where the late moth stands on the landing tick: beyond the range. */
const CLEAR_DX = 700;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("deals nothing to a moth moved onto the strike on the tick after it landed", async () => {
  assertEqual(sparkRow(LEVEL).amount, 1, "the level-1 row's amount");
  assertGreaterThan(CLEAR_DX, SPARK_RANGE, "the late moth against the range");
  const volley = armSpark(h, LEVEL, [
    { x: TARGET_DX, y: 0 },
    { x: CLEAR_DX, y: 0 },
  ]);
  const [target, late] = volley.targets;

  const landed = await h.tick(1);
  const strikes = strikesIn(landed);
  assertEqual(strikes.length, 1, "Spark strikes on the landing tick");
  const [strike] = strikesOn(strikes, target);
  assertEqual(strike !== undefined, true, "the strike centered on the target");
  assertUnhurt(
    volley.posed,
    landed,
    late.id,
    "the late moth on the landing tick",
  );

  h.debug.setEnemyPosition(late.id, strike.x, strike.y);
  const moved = h.snapshot();
  const after = await h.tick(1);
  captureStill(h, "once");

  assertUnhurt(moved, after, late.id, "the moth on the strike a tick late");
});
