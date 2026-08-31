// presentation/tripped-reads-apart — a tripped tower is drawn plainly apart from
// an online one carrying the same heat.
//
// THE RULE. `specs/overview.md`'s legibility table: "A tripped tower — A tripped
// tower is unmistakable and reads apart from an online tower at the same heat."
// The clause "at the same heat" is the whole of the item, and it is what makes it
// a check rather than a restatement of `presentation/heat-glow-ramp`: a build that
// draws nothing for the trip and lets the heat ramp speak still shows SOME
// difference between a tripped tower and an online one, because a tower that just
// tripped is hot and one that is running is usually not. So the two readings are
// taken at ONE heat, and the trip must be visible there.
//
// THE ONE VARIABLE. Both readings are of the SAME tower, on the same tile, at the
// same type, level, rotation and heat, one frame apart, with nothing between them
// but `setTowerTripped`. That is what makes the reading a reading of the trip:
// `specs/heat.md` makes the drawn colour a function of the heat, so two towers
// posed side by side would differ in their tiles as well as their state, and the
// same tower before and after differs in exactly one thing.
//
// WHY THE THERMAL MODEL IS OFF. `posePinnedTower` holds the tower's part in the
// heat model (`specs/instrumentation.md`), so the heat this check posed is the
// heat both frames drew. Air cooling is proportional to heat (`specs/heat.md`),
// so an unpinned tower would be a little cooler on the second frame and the
// reading would be part trip and part ramp. The guns are off for the same reason
// in the other direction: nothing is fired, so no shot is drawn over either frame.
//
// WHY THE HEAT IS RE-POSED AFTER THE TRIP. `specs/heat.md` makes a trip a state
// the tower enters, and leaves what happens to the heat on entering it to the
// model rather than to this check; re-posing the heat after the flag is set is
// what guarantees the two frames are at the SAME heat whatever the build does
// with it.
//
// WHY THREE HEATS AND THE WHOLE EMITTER ROSTER. `specs/heat.md` lets a tripped
// tower sit anywhere below `TRIP_HEAT` while its cooldown runs, so "the same
// heat" is not one heat; a build whose trip look happens to land on its own ramp
// at one point is caught by the other two. And `specs/towers.md` gives each
// emitter its own figures, so nothing says the six share one ramp or one trip
// look. The Forge and the Sink are not read: `specs/towers.md` says both "carry no
// heat", and `specs/heat.md` never trips them.
//
// WHAT IT DOES NOT DECIDE. Whether the tower actually TRIPS at 100 is
// `trip/trips-at-100`, what a tripped tower stops doing is `trip/`'s items, and
// what the ramp does between heats is `presentation/heat-glow-ramp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { EMITTER_TYPES, TRIP_HEAT, TRIP_TIME } from "../constants";
import type { TowerType } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  posePinnedTower,
  requireTower,
  startRun,
  type Harness,
} from "../harness";
import { bodyColor, showRgb } from "./read";

/**
 * How far the two must sit apart, out of the 441 the RGB cube spans.
 *
 * This group's figure for "plainly apart" (`specs/overview.md`), the same one it
 * holds a tower against the floor and the ramp's two ends to. 60 is about a
 * seventh of the scale. "Unmistakable" in the legibility table reads as at least
 * that and arguably more; the group's own figure is the honest floor, and a build
 * that clears it by a hair has still drawn a tower a player can tell has tripped.
 */
const APART_MIN = 60;

/**
 * The heats the pair is read at, all of them reachable by a tripped tower.
 *
 * `specs/heat.md` puts the trip at `TRIP_HEAT` and runs a cooldown from there, so
 * a tripped tower passes down through every heat below it. `TRIP_HEAT - 1` is the
 * hottest a tower can be while still online, so it is the hardest case for a build
 * that leans on the ramp alone, and 20 the coldest end of the cooldown.
 */
const HEATS: readonly number[] = [20, 55, TRIP_HEAT - 1];

/** Which pass leaves the two pictures behind. */
const CAPTURE_TYPE: TowerType = "arc";
const CAPTURE_AT = HEATS[1];

/** Where the tower stands: clear of the casing and of both corridors. */
const AT = { col: 12, row: 8 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it.each(EMITTER_TYPES)(
  "draws a tripped %s apart from an online one at the same heat",
  async (type) => {
    await startRun(h);

    for (const heat of HEATS) {
      await h.debug.clearTowers();
      const id = await posePinnedTower(h, type, AT.col, AT.row, heat);
      await h.debug.setTowerFiring(id, false);

      await h.advance(1);
      const capture = type === CAPTURE_TYPE && heat === CAPTURE_AT;
      if (capture) await captureStill(h, "online");
      const online = await bodyColor(
        h,
        requireTower(await h.snapshot(), id, `the online ${type}`),
      );

      await h.debug.setTowerTripped(id, true);
      await h.debug.setTowerTripTimer(id, TRIP_TIME);
      await h.debug.setTowerHeat(id, heat);
      await h.advance(1);
      if (capture) await captureStill(h, "tripped");
      const tripped = await bodyColor(
        h,
        requireTower(await h.snapshot(), id, `the tripped ${type}`),
      );

      assertGreaterThanOrEqual(
        colorDistance(online, tripped),
        APART_MIN,
        `a ${type} at heat ${heat}: online (${showRgb(online)}) against the ` +
          `same tower tripped (${showRgb(tripped)}), on the same tile at the ` +
          `same heat (specs/overview.md: a tripped tower reads apart from an ` +
          `online tower at the same heat)`,
      );
    }
  },
);
