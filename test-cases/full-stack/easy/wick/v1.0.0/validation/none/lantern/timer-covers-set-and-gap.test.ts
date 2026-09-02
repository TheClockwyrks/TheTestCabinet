// Wick — lantern/timer-covers-set-and-gap: Lantern's timer is set to duration
// plus cooldown, so the next set fires once the previous has been gone for the
// cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "On firing,
// Lantern's cooldown timer is set to `duration` plus the current cooldown, both
// read on that tick, so the timer is due once the set has been gone for the
// cooldown and one set is in the world at a time." Row 1 of `LANTERN_LEVELS`
// carries duration `3.0` and cooldown `3.0`, the cooldown times a
// `cooldownMul` of `1` with no Oil held, so the slot reads `6.0` on the firing
// tick. `specs/world.md` ("Timers"): "a timer set to `s` seconds is due
// `round(s × TICK_HZ)` ticks after the tick it was set on", `round(6.0 × 60)`
// = `360`, and "A timer is due on every tick on which it is `0` after its
// count-down", so nothing fires on the 359 ticks between and the 360th fires
// again; the set's ttl of `3.0` is due `180` ticks after the firing, so the
// second set lands `180` ticks after the first vanished.
//
// WHAT IS READ. A firing creates lantern zones with fresh ids, so each tick's
// created zones — the entries whose id is at least the `nextId` the previous
// tick left — say whether Lantern fired on it, and the first set's lantern is
// looked for by id on every tick. Every tick from the first firing to the due
// tick is stepped one at a time, so the reading is per tick rather than per
// span.
//
// THE POSE. An isolated night with Lantern alone at level 1, fired through the
// shared `fireWeapon` (held, due, `weaponFire` on, one tick), and `weaponFire`
// left on so the timer counts. Nothing else runs: no spawns, no motion, no
// contact, no effect motion, so the only ids the night hands out are
// lanterns'. Lantern needs no target, so no enemy is posed and the set hits
// nothing.
//
// TOLERANCE. `TIMER_TOL` on the timer read straight after the firing, which a
// build sets from the table figures rather than integrating; none on the
// ticks, which the timer rule fixes exactly.

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
  zoneById,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { lanternTimer, lanternsOf } from "./stage";

/** The level fired. */
const LEVEL = 1;

const ROW = weaponRow("lantern", LEVEL);

/** The seconds the firing sets the timer to: `3.0 + 3.0` = `6.0`. */
const TIMER = lanternTimer(ROW);

/** The ticks after the firing on which Lantern is due again: `round(6.0 × 60)` = `360`. */
const PERIOD = dueTicks(TIMER);

/** The ticks the set is gone for before the next firing: `round(3.0 × 60)` = `180`. */
const GAP = dueTicks(ROW.cooldown!);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The Lantern lanterns `after` holds that `before` did not. */
function lanternsCreated(before: WickSnapshot, after: WickSnapshot) {
  return newZones(before, after).filter(
    (zone) => zone.kind === "lantern" && zone.weapon === "lantern",
  );
}

it("reads 6.0 on the firing tick and fires the next set 360 ticks later, 180 after the first vanished", async () => {
  await isolate(h);

  const period = await captureReplay(h, "gap", async () => {
    const fired = await fireWeapon(h, "lantern", LEVEL);
    const first = lanternsOf(fired);
    assertGreaterThan(
      first.length,
      0,
      "Lantern lanterns the first firing tick created",
    );
    const lantern = first[0]!;
    assertNear(
      weaponIn(fired.after, "lantern")?.cooldown ?? NaN,
      TIMER,
      TIMER_TOL,
      "Lantern's timer on the tick it fired",
    );

    // The ticks between: one at a time, so a firing on any of them is seen,
    // and the tick the first set vanished on is the first without its lantern.
    let previous = fired.after;
    let vanishedOn: number | null = null;
    const between = await h.stepWatching(PERIOD - 1);
    const early: number[] = [];
    for (const [index, snapshot] of between.entries()) {
      if (lanternsCreated(previous, snapshot).length > 0) early.push(index + 1);
      if (vanishedOn === null && zoneById(snapshot, lantern.id) === undefined) {
        vanishedOn = index + 1;
      }
      previous = snapshot;
    }

    const due = await h.step(1);
    return {
      early,
      vanishedOn,
      onDue: lanternsCreated(previous, due).length,
      firstOnDue: zoneById(due, lantern.id),
      tick: due.run.tick - fired.after.run.tick,
    };
  });

  assertDeepEqual(
    period.early,
    [],
    "the ticks, counted from the firing, on which Lantern fired before it was due",
  );
  assertEqual(period.tick, PERIOD, "the ticks stepped to the due tick");
  assertGreaterThan(
    period.onDue,
    0,
    `Lantern lanterns created on the tick ${PERIOD} ticks after the firing`,
  );
  assertEqual(
    period.firstOnDue,
    undefined,
    "the first set's lantern on the tick the next set fired",
  );
  assertEqual(
    period.vanishedOn === null ? null : PERIOD - period.vanishedOn,
    GAP,
    "the ticks the first set had been gone for when the next set fired",
  );
});
