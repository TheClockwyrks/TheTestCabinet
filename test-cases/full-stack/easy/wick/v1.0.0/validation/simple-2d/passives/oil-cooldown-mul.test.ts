// passives/oil-cooldown-mul — Oil multiplies a weapon's cooldown by
// 1 − OIL_COOLDOWN_PER_LEVEL per level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil", with
// OIL_COOLDOWN_PER_LEVEL 0.08, so Oil 2 gives 0.84; and ("Cooldown") "A
// weapon's cooldown is its table `cooldown` times `cooldownMul`, floored at
// MIN_COOLDOWN (0.2) seconds", with "A weapon's timer ... set from this value
// each time the weapon fires". Row 1 of TAPER_LEVELS gives cooldown 1.35
// (specs/weapons.md, "Taper"), so the timer reads 1.35 × 0.84 = 1.134, above
// the floor. specs/world.md ("Timers"): "a timer set to s seconds is due
// round(s × TICK_HZ) ticks after the tick it was set on", so the next firing
// lands round(1.134 × 60) = 68 ticks after the first.
//
// THE WORLD. An isolated playing run: nothing on the field, Oil at level 2 in
// the first passive slot, Taper alone at level 1 with its timer at 0, and every
// driver switch off but weaponFire. Taper needs no target, so no enemy is posed
// and the only zones that can ever appear are Taper's; each new zone id is
// therefore a firing.
//
// WHAT IS READ. Taper's timer after the firing tick, and the ticks of the
// following 68 on which a slash with an id not seen before appeared, exactly
// [68]. The pair is decided: a build that reports the scaled figure but counts
// the table one, and one that counts the scaled figure without reporting it,
// each miss one reading.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the timer, a product of two stated
// figures read back as a double. None on the tick, which the timer rule fixes
// to a whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  TAPER_LEVELS,
  cooldownFor,
  ticksFor,
  type HeldPassives,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  zonesOf,
  type Harness,
} from "../harness";
import {
  armAll,
  freshTicks,
  holdPassives,
  slotOf,
  timerOf,
  zoneIdsOf,
} from "./night";

/** The passives held: Oil at level 2. */
const HELD: HeldPassives = { oil: 2 };

/** The Taper level fired: row 1, cooldown 1.35. */
const LEVEL = 1;

/** max(0.2, 1.35 × 0.84) = 1.134. */
const COOLDOWN = cooldownFor(TAPER_LEVELS[LEVEL - 1].cooldown, HELD);

/** round(1.134 × 60) = 68 ticks. */
const PERIOD_TICKS = ticksFor(COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sets Taper's timer to 1.134 with Oil 2 held and fires again 68 ticks later", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const slots = armAll(h, [["taper", LEVEL]]);

  const run = await captureReplay(h, "cooldown", async () => {
    const fired = await h.tick(1);
    const seen = new Set(zoneIdsOf(fired, "taper"));
    const trace = await h.trace(PERIOD_TICKS);
    return {
      fired,
      slashes: zonesOf(fired, "taper").length,
      firings: freshTicks(trace, (s) => zoneIdsOf(s, "taper"), seen),
    };
  });

  assertEqual(run.slashes > 0, true, "whether Taper fired on the first tick");
  assertWithin(
    timerOf(run.fired, slotOf(slots, "taper")),
    COOLDOWN,
    FIGURE_TOLERANCE,
    "Taper's timer after the firing tick with Oil 2 held",
  );
  assertDeepEqual(
    run.firings,
    [PERIOD_TICKS],
    "the ticks after the first firing on which a new slash appeared",
  );
});
