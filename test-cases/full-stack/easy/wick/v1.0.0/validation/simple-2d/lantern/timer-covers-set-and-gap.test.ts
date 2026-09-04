// Wick — lantern/timer-covers-set-and-gap: Lantern's timer is set to the
// set's duration plus the cooldown, so the next set follows the gap.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "On firing, Lantern's cooldown timer is
//     set to `duration` plus the current cooldown, both read on that tick, so
//     the timer is due once the set has been gone for the cooldown and one
//     set is in the world at a time"; row 1 has duration `3.0` and cooldown
//     `3.0`, and with no Oil held the current cooldown is the table figure
//     ("Cooldown timers", `specs/passives.md`), so the timer reads `6.0`.
//   - `specs/weapons.md` ("Cooldown timers"): "the weapon fires again on the
//     tick the timer is due"; `specs/world.md` ("Timers"): a timer of `6.0`
//     is due `round(6.0 × 60) = 360` ticks after the firing tick, and the
//     set's `ttl` of `3.0` is due `180` ticks after it, so the field holds no
//     lantern from the 180th tick through the 359th, 180 ticks.
//   - `specs/world.md` ("One tick"), phase 5: the timer counts down and the
//     due weapon fires within the same tick, so the reading after the firing
//     tick is the freshly set figure.
//   - `specs/state.md` (`ZoneState.id`): "unique for the run, assigned from
//     `nextId`", which is what tells the second set from the first.
//
// WHAT IS READ. Lantern's timer after the first firing, `6.0`; the ticks
// after that firing on which a lantern with an id not seen before appeared,
// exactly `[360]`; and that no Lantern lantern is in the world after the
// 359th tick, the last of the gap.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 1, nothing on the
// field, every switch off but `weaponFire`, so the only zones that can ever
// appear are Lantern's and each new id is a firing; `effectMotion` off holds
// the lanterns still, which the timer never reads.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the timer reading, a sum of two stated
// figures read back as a double. None on the ticks: the rule fixes each to a
// whole count.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, ticksFor } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { armLantern, lanternRow, lanternsOf, timerAfterFiring } from "./orbit";

/** The level this point holds Lantern at. */
const LEVEL = 1;

/** Row 1 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** The seconds the timer is set to on the firing: 3.0 + 3.0. */
const TIMER = timerAfterFiring(ROW);

/** The ticks between the first firing and the second: round(6.0 × 60). */
const PERIOD_TICKS = ticksFor(TIMER);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets the timer to 6.0 and fires the next set exactly 360 ticks later, after a 180-tick gap", async () => {
  const orbit = armLantern(h, LEVEL);

  const period = await captureReplay(h, "gap", async () => {
    const first = await h.tick(1);
    const seen = new Set(lanternsOf(first).map((lantern) => lantern.id));
    // Which of the following ticks brought a lantern id not seen before,
    // counted from 1 for the tick right after the first firing.
    const firings: number[] = [];
    const trace = await h.trace(PERIOD_TICKS);
    trace.forEach((snapshot, index) => {
      const fresh = lanternsOf(snapshot)
        .map((lantern) => lantern.id)
        .filter((id) => !seen.has(id));
      if (fresh.length > 0) firings.push(index + 1);
      for (const id of fresh) seen.add(id);
    });
    return {
      first,
      firings,
      beforeSecond: lanternsOf(trace[PERIOD_TICKS - 2]).length,
    };
  });

  assertEqual(
    lanternsOf(period.first).length > 0,
    true,
    "whether Lantern fired on the first tick",
  );
  assertWithin(
    period.first.run.weapons[orbit.slot]?.cooldown ?? Number.NaN,
    TIMER,
    FIGURE_TOLERANCE,
    "Lantern's timer after its first firing, duration plus cooldown",
  );
  assertEqual(
    period.beforeSecond,
    0,
    `Lantern lanterns after tick ${PERIOD_TICKS - 1}, the last tick of the gap`,
  );
  assertDeepEqual(
    period.firings,
    [PERIOD_TICKS],
    "the ticks after the first firing on which a new lantern appeared",
  );
});
