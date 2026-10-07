// passives/oil-cooldown-mul — Oil multiplies a weapon's cooldown by
// `1 − OIL_COOLDOWN_PER_LEVEL` per level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` gives the term and the
// formula: `OIL_COOLDOWN_PER_LEVEL` is `0.08`, and
// "cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil", so Oil 2 is `0.84`. The
// Cooldown section applies it: "A weapon's cooldown is its table `cooldown`
// times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`) seconds", and "A
// weapon's timer is set from this value each time the weapon fires". Taper's
// level-1 row gives `cooldown` `1.35` (`specs/weapons.md`, Taper), so the
// timer reads `1.35 × 0.84 = 1.134`, well above the floor.
//
// WHEN THE NEXT FIRING LANDS. `specs/world.md`, Timers: "a timer set to `s`
// seconds is due `round(s × TICK_HZ)` ticks after the tick it was set on", so
// `round(1.134 × 60)` = `68` ticks after the firing tick, and the tick before
// that fires nothing.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Oil 2 and Taper at
// level 1 alone. Taper "needs a target: no" (`specs/weapons.md`, Targeting
// summary), so the world holds no enemy at all and nothing but the timer
// decides when the slash appears. Every driver switch but `weaponFire` stays
// off, so no spawn, no motion, and no contact arrives across the sixty-eight
// ticks watched. A slash is read as a zone the tick created, by id against
// the `nextId` of the snapshot before it.
//
// THE TOLERANCE. `REAL_EPS` on the timer, one table figure times one
// multiplier; the unscaled figure, `1.35`, is a fifth of a second away. The
// tick the second slash lands on is a whole count, compared exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, TAPER_LEVELS, cooldownOf, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  type Harness,
  zonesCreatedSince,
} from "../harness";
import { fireUnder, timerOf } from "./firing";

/** The Oil level held: `cooldownMul` `0.84`. */
const OIL = 2;

/** Taper's level-1 row, whose `cooldown` is `1.35`. */
const ROW = TAPER_LEVELS[0];

/** The cooldown the row's `1.35` becomes under Oil 2: `1.134`. */
const COOLDOWN = cooldownOf(ROW.cooldown, OIL);

/** Ticks from one firing to the next: `round(1.134 × 60)` = `68`. */
const INTERVAL = ticksOf(COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets Taper's timer to 1.134 under Oil 2 and fires again 68 ticks later", async () => {
  const firing = await fireUnder(h, {
    passives: [["oil", OIL]],
    weapons: [["taper", 1]],
  });

  assertEqual(
    firing.zones.length,
    ROW.amount,
    "the slashes the firing tick created (specs/weapons.md, Taper)",
  );
  assertNear(
    timerOf(firing, "taper"),
    COOLDOWN,
    REAL_EPS,
    "Taper's timer after the firing under Oil 2 (specs/passives.md, Cooldown)",
  );

  await captureReplay(h, "cooldown", async () => {
    const short = await advanceTicks(h, INTERVAL - 1);
    assertEqual(
      zonesCreatedSince(firing.after, short).length,
      0,
      `the slashes created over the ${INTERVAL - 1} ticks before the timer is due (specs/world.md, Timers)`,
    );
    const due = await advanceTicks(h, 1);
    assertEqual(
      zonesCreatedSince(short, due).length,
      ROW.amount,
      `the slashes created on tick ${INTERVAL} after the firing (specs/world.md, Timers)`,
    );
  });
});
