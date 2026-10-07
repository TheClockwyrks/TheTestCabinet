// weapons/cooldown-period — a weapon fires again on the tick its timer is due,
// and on no tick between.
//
// THE SPEC LINE. `specs/weapons.md`, "Cooldown timers": "After firing, the
// timer is set to the weapon's current cooldown, and the weapon fires again on
// the tick the timer is due. The current cooldown is the table cooldown times
// `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)." Taper's level-1 row gives
// cooldown `1.35`, and with no Oil held `cooldownMul` is `1`
// (`specs/passives.md`), so the timer reads `1.35` on the tick Taper fires.
// `specs/world.md`, "Timers": "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", which is
// `round(1.35 × 60)` = `81` ticks, and "A timer is due on every tick on which
// it is `0` after its count-down" — so nothing fires on the eighty ticks
// between, and the eighty-first fires.
//
// WHAT IS READ. A firing creates a slash zone with a fresh id
// (`specs/weapons.md`, "Taper"), so each tick's created zones, the entries
// whose id is at least the `nextId` the previous tick left, say whether Taper
// fired on it. Every tick from the first firing to the due tick is stepped one
// at a time, so the reading is per tick rather than per span.
//
// THE POSE. An isolated world with Taper alone, held at level 1 with its timer
// posed to `0` and `weaponFire` on, so the next tick is the first firing.
// Nothing else runs: no spawns, no motion, no contact, and no effect motion,
// so the only ids the world hands out are slashes'. Taper needs no target, so
// no enemy is posed, and the slashes hit nothing.
//
// THE TOLERANCE. `REAL_EPS` on the timer read straight after the firing, which
// a build sets from the table figure rather than integrating; none on the
// tick, which the timer rule fixes exactly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
} from "../assert";
import { REAL_EPS, TAPER_LEVELS, ticksOf } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  heldWeapon,
  holdWeapon,
  isolate,
  zonesCreatedSince,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Taper's level-1 cooldown, `1.35` seconds, from `TAPER_LEVELS`. */
const COOLDOWN = TAPER_LEVELS[0].cooldown;

/** Ticks after the firing on which Taper is due again: `round(1.35 × 60)` = `81`. */
const PERIOD = ticksOf(COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** The Taper slashes `after` holds that `before` did not. */
function slashesCreated(before: WickSnapshot, after: WickSnapshot): number {
  return zonesCreatedSince(before, after).filter(
    (zone) => zone.kind === "slash" && zone.weapon === "taper",
  ).length;
}

it("fires Taper again exactly round(1.35 × 60) ticks after it fired", async () => {
  isolate(h);
  const slot = holdWeapon(h, "taper", 1);
  armWeapon(h, slot);

  const period = await captureReplay(h, "period", async () => {
    const posed = h.snapshot();
    const fired = await advanceTicks(h, 1);
    assertGreaterThan(
      slashesCreated(posed, fired),
      0,
      "Taper slashes the first firing tick created",
    );
    assertNear(
      heldWeapon(fired, "taper")?.cooldown ?? NaN,
      COOLDOWN,
      REAL_EPS,
      "Taper's timer on the tick it fired (specs/weapons.md, Cooldown timers)",
    );

    // The ticks between: one at a time, so a firing on any of them is seen.
    let previous = fired;
    const early: number[] = [];
    for (let tick = 1; tick < PERIOD; tick += 1) {
      const s = await advanceTicks(h, 1);
      if (slashesCreated(previous, s) > 0) early.push(tick);
      previous = s;
    }

    const due = await advanceTicks(h, 1);
    return {
      early,
      onDue: slashesCreated(previous, due),
      tick: due.run.tick - fired.run.tick,
    };
  });

  assertDeepEqual(
    period.early,
    [],
    "the ticks, counted from the firing, on which Taper fired before it was due (specs/world.md, Timers)",
  );
  assertEqual(period.tick, PERIOD, "the ticks stepped to the due tick");
  assertGreaterThan(
    period.onDue,
    0,
    `Taper slashes created on the tick ${PERIOD} ticks after the firing (specs/weapons.md, Cooldown timers)`,
  );
});
