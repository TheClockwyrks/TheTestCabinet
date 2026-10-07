// passives/cooldown-mul-read-when-set — a running timer keeps the value it was
// set with, and the next firing reads the Oil level gained since.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`, Cooldown: "A weapon's
// timer is set from this value each time the weapon fires, and a timer already
// counting keeps the value it was set with." The same file's opening rule says
// when a new level takes hold: "a passive gained mid-run takes effect on the
// next read: the next hit, the next time a weapon sets its cooldown timer".
// So a timer standing at `1.0` when Oil 5 is gained keeps counting from `1.0`,
// falling `TICK_DT` a tick (`specs/world.md`, Timers), and is due
// `round(1.0 × 60)` = `60` ticks after the tick it was set on. The firing that
// tick performs then sets the timer afresh, from Taper's level-1 `cooldown`
// `1.35` (`specs/weapons.md`, Taper) times `cooldownMul` `0.6`: `0.81`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Taper at level 1
// alone, its timer posed to `1.0` through `setWeaponCooldown` with
// `weaponFire` on, and Oil 5 placed after the timer is already counting. Taper
// needs no target, so the world holds no enemy and nothing but the timer
// decides when the slash appears. A build that rescaled the running timer to
// `0.6` would fire nineteen ticks early; one that never applied Oil would set
// `1.35` on the second firing.
//
// THE TOLERANCE. `REAL_EPS` on the timer's readings, which are one posed value
// less a whole number of `TICK_DT` steps, and on the cooldown the firing sets,
// one table figure times one multiplier.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  REAL_EPS,
  TAPER_LEVELS,
  TICK_DT,
  cooldownOf,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  type Harness,
  zonesCreatedSince,
} from "../harness";

/** The Oil level gained while the timer is already counting. */
const OIL = 5;

/** The value the timer is posed to, and counts down from. */
const RUNNING = 1.0;

/** Ticks until the running timer is due: `round(1.0 × 60)` = `60`. */
const REMAINING = ticksOf(RUNNING);

/** Taper's level-1 row, whose `cooldown` is `1.35`. */
const ROW = TAPER_LEVELS[0];

/** What the firing sets the timer to under Oil 5: `1.35 × 0.6 = 0.81`. */
const NEXT = cooldownOf(ROW.cooldown, OIL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps Taper's running timer at 1.0 across gaining Oil 5 and sets 0.81 on the next firing", async () => {
  isolate(h);
  const slot = holdWeapon(h, "taper", 1);
  h.debug.setWeaponCooldown(slot, RUNNING);
  h.debug.setWeaponFire(true);
  holdPassive(h, "oil", OIL);
  const armed = h.snapshot();

  await captureReplay(h, "kept", async () => {
    const first = await advanceTicks(h, 1);
    assertNear(
      first.run.weapons[slot].cooldown,
      RUNNING - TICK_DT,
      REAL_EPS,
      "Taper's timer one tick after Oil 5 was gained (specs/passives.md, Cooldown)",
    );

    const short = await advanceTicks(h, REMAINING - 2);
    assertNear(
      short.run.weapons[slot].cooldown,
      RUNNING - (REMAINING - 1) * TICK_DT,
      REAL_EPS,
      `Taper's timer ${REMAINING - 1} ticks after Oil 5 was gained (specs/world.md, Timers)`,
    );
    assertEqual(
      zonesCreatedSince(armed, short).length,
      0,
      `the slashes created over the ${REMAINING - 1} ticks before the running timer is due (specs/world.md, Timers)`,
    );

    const due = await advanceTicks(h, 1);
    assertEqual(
      zonesCreatedSince(short, due).length,
      ROW.amount,
      `the slashes created on tick ${REMAINING} of the running timer (specs/world.md, Timers)`,
    );
    assertNear(
      due.run.weapons[slot].cooldown,
      NEXT,
      REAL_EPS,
      "Taper's timer after the firing that read Oil 5 (specs/passives.md, Cooldown)",
    );
  });
});
