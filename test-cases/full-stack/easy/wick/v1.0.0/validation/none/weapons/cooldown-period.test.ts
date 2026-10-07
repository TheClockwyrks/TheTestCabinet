// Wick — weapons/cooldown-period: a weapon fires again on the tick its timer is
// due, and on no tick between.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Cooldown timers"):
// "After firing, the timer is set to the weapon's current cooldown, and the
// weapon fires again on the tick the timer is due. The current cooldown is the
// table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)."
// Taper's level-1 row gives cooldown `1.35`, and with no Oil held
// `cooldownMul` is `1` (`specs/passives.md`), so the timer reads `1.35` on the
// tick Taper fires. `specs/world.md` ("Timers"): "a timer set to `s` seconds is
// due `round(s × TICK_HZ)` ticks after the tick it was set on", which is
// `round(1.35 × 60)` = `81` ticks, and "A timer is due on every tick on which
// it is `0` after its count-down" — so nothing fires on the eighty ticks
// between, and the eighty-first fires.
//
// WHAT IS READ. A firing creates a slash zone with a fresh id
// (`specs/weapons.md`, "Taper"), so each tick's created zones — the entries
// whose id is at least the `nextId` the previous tick left — say whether Taper
// fired on it. Every tick from the first firing to the due tick is stepped one
// at a time, so the reading is per tick rather than per span.
//
// THE POSE. An isolated night with Taper alone, fired once through the shared
// `fireWeapon` (held, due, `weaponFire` on, one tick). Nothing else runs: no
// spawns, no motion, no contact, and no effect motion, so the only id the night
// hands out is a slash's. Taper needs no target, so no enemy is posed, and the
// slash hits nothing.
//
// TOLERANCE. `TIMER_TOL` on the timer read straight after the firing, which a
// build sets from the table figure rather than integrating; none on the tick,
// which the timer rule fixes exactly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNear,
} from "../assert";
import { TIMER_TOL, dueTicks, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  fireWeapon,
  isolate,
  newZones,
  weaponIn,
  type Harness,
  type WickSnapshot,
} from "../harness";

/** Taper's level-1 cooldown, `1.35` seconds, from `TAPER_LEVELS`. */
const COOLDOWN = weaponRow("taper", 1).cooldown!;

/** The ticks after the firing on which Taper is due again: `round(1.35 × 60)` = `81`. */
const PERIOD = dueTicks(COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The Taper slashes `after` holds that `before` did not. */
function slashesCreated(before: WickSnapshot, after: WickSnapshot) {
  return newZones(before, after).filter(
    (zone) => zone.kind === "slash" && zone.weapon === "taper",
  );
}

it("fires Taper again exactly round(1.35 × 60) ticks after it fired", async () => {
  await isolate(h);

  const period = await captureReplay(h, "period", async () => {
    const fired = await fireWeapon(h, "taper", 1);
    assertGreaterThan(
      slashesCreated(fired.before, fired.after).length,
      0,
      "Taper slashes the first firing tick created",
    );
    assertNear(
      weaponIn(fired.after, "taper")?.cooldown ?? NaN,
      COOLDOWN,
      TIMER_TOL,
      "Taper's timer on the tick it fired",
    );

    // The ticks between: one at a time, so a firing on any of them is seen.
    let previous = fired.after;
    const between = await h.stepWatching(PERIOD - 1);
    const early: number[] = [];
    for (const [index, snapshot] of between.entries()) {
      if (slashesCreated(previous, snapshot).length > 0) early.push(index + 1);
      previous = snapshot;
    }

    const due = await h.step(1);
    return {
      early,
      onDue: slashesCreated(previous, due).length,
      tick: due.run.tick - fired.after.run.tick,
    };
  });

  assertDeepEqual(
    period.early,
    [],
    "the ticks, counted from the firing, on which Taper fired before it was due",
  );
  assertEqual(period.tick, PERIOD, "the ticks stepped to the due tick");
  assertGreaterThan(
    period.onDue,
    0,
    `Taper slashes created on the tick ${PERIOD} ticks after the firing`,
  );
});
