// Wick — clock/timer-due-after-round: a timer is due exactly
// `round(s × TICK_HZ)` ticks after it is set.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("Timers"): "On every tick a timer counts down by
//     `TICK_DT` and is held at `0`: a count-down that would leave it below
//     `TICK_DT / 2` leaves it at exactly `0`. A timer is due on every tick on
//     which it is `0` after its count-down, so a timer set to `s` seconds is
//     due `round(s × TICK_HZ)` ticks after the tick it was set on".
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown, and the weapon fires again on the tick
//     the timer is due." Taper's level 1 row: cooldown `1.35`, so the timer
//     is due `round(1.35 × 60)` = 81 ticks after the firing.
//   - `specs/weapons.md` ("Taper"): "A slash is a rectangle ... on the tick it
//     fires it hits every enemy overlapping it", so a firing is one new zone
//     of kind `slash` with the next id.
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "Sets the cooldown
//     timer of the weapon in `slot` ... to `seconds`", the way a timer of 0.5 s
//     is set here, due `round(0.5 × 60)` = 30 ticks later.
//
// THE DRIVE. An isolated run keeping Taper, `weaponFire` on and every other
// switch off, so the slash is the only thing that happens. Taper is armed and
// fires on the first tick, setting its timer to 1.35. The ticks after it are
// walked one at a time: no new slash on ticks 1 to 80 after the firing, and a
// new slash on the 81st. Then the timer is posed to 0.5 and walked the same
// way: no new slash on ticks 1 to 29 after the pose, a new slash on the 30th.
//
// WHAT IS READ. A firing is read as a slash zone with an id not seen before,
// because a slash is created on its firing tick and on no other; the cooldown
// after the firing tick reads 1.35 again, since the firing set it, so the
// timer's `0` on the due tick is observed through the firing it causes.
//
// TOLERANCE. None on the ticks: `round(s × TICK_HZ)` is a whole number, and a
// build a tick out has broken the stated rule. `REAL_EPS` on the timer read
// after the firing, one stated real, and on the timer one tick short of due,
// `TICK_DT` after eighty count-downs.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  MOTION_EPS,
  REAL_EPS,
  TAPER_LEVELS,
  TICK_DT,
  ticksOf,
} from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";

/** Taper's level 1 cooldown, and the ticks until it is due. */
const TAPER_COOLDOWN = TAPER_LEVELS[0].cooldown;
const TAPER_DUE_TICKS = ticksOf(TAPER_COOLDOWN);

/** The posed timer, and the ticks until it is due. */
const POSED_COOLDOWN = 0.5;
const POSED_DUE_TICKS = ticksOf(POSED_COOLDOWN);

/** Taper's slot in a fresh run: the first. */
const TAPER_SLOT = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The tick, counted from the previous firing, on which a new slash appeared. */
async function ticksUntilFiring(maxTicks: number): Promise<{
  firedOn: number | null;
  beforeDue: number;
  afterFiring: number;
}> {
  const known = new Set(zonesOfKind(h.snapshot(), "slash").map((z) => z.id));
  let firedOn: number | null = null;
  let beforeDue = Number.NaN;
  let afterFiring = Number.NaN;
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const s = await advanceTicks(h, 1);
    if (tick === maxTicks - 1) beforeDue = s.run.weapons[TAPER_SLOT].cooldown;
    const fresh = zonesOfKind(s, "slash").some((z) => !known.has(z.id));
    if (fresh && firedOn === null) {
      firedOn = tick;
      afterFiring = s.run.weapons[TAPER_SLOT].cooldown;
    }
    for (const z of zonesOfKind(s, "slash")) known.add(z.id);
  }
  return { firedOn, beforeDue, afterFiring };
}

it("fires Taper again on the 81st tick after a firing, and 30 ticks after a posed 0.5", async () => {
  isolate(h, { keepTaper: true });
  armWeapon(h, TAPER_SLOT);

  const due = await captureReplay(h, "due", async () => {
    const first = await advanceTicks(h, 1);
    const firstSlashes = zonesOfKind(first, "slash").length;
    const firstCooldown = first.run.weapons[TAPER_SLOT].cooldown;
    const long = await ticksUntilFiring(TAPER_DUE_TICKS);

    h.debug.setWeaponCooldown(TAPER_SLOT, POSED_COOLDOWN);
    const short = await ticksUntilFiring(POSED_DUE_TICKS);
    return { firstSlashes, firstCooldown, long, short };
  });

  assertEqual(
    due.firstSlashes,
    1,
    "the slashes the armed Taper fired on tick 1",
  );
  assertNear(
    due.firstCooldown,
    TAPER_COOLDOWN,
    REAL_EPS,
    "Taper's timer after the firing set it",
  );
  assertNear(
    due.long.beforeDue,
    TICK_DT,
    MOTION_EPS,
    `Taper's timer on the ${TAPER_DUE_TICKS - 1}th tick after the firing`,
  );
  assertEqual(
    due.long.firedOn,
    TAPER_DUE_TICKS,
    "the tick after the firing on which Taper fired again",
  );
  assertNear(
    due.long.afterFiring,
    TAPER_COOLDOWN,
    REAL_EPS,
    "Taper's timer after the second firing set it",
  );
  assertEqual(
    due.short.firedOn,
    POSED_DUE_TICKS,
    "the tick after the timer was posed to 0.5 on which Taper fired",
  );
});
