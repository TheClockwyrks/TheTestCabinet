// presentation/tripped-reads-apart — a tripped tower is drawn plainly apart from
// an online one carrying the same heat.
//
// THE RULE. specs/overview.md's legibility table: "A tripped tower is
// unmistakable and reads apart from an online tower at the same heat." The clause
// "at the same heat" is the whole of the item, and it is what makes it a check
// rather than a restatement of `heat-glow-ramp`: a build that draws nothing for
// the trip and lets the heat ramp speak still shows SOME difference between a
// tripped tower and an online one, because a tower that just tripped is hot and
// one that is running is usually not. So the two readings are taken at ONE heat,
// and the trip must be visible there.
//
// THE ONE VARIABLE. Both readings are of the SAME tower, on the same tile, at the
// same type, level, rotation and heat, one frame apart, with nothing between them
// but the trip. specs/heat.md makes the drawn colour a function of the heat, so
// two towers posed side by side would differ in their tiles as well as in their
// state, and the same tower before and after differs in exactly one thing.
//
// WHY BOTH FACULTIES ARE HELD. `poseStillTower` holds the tower's part in the
// heat model and its guns (presentation/pose.ts), so the heat this check posed is
// the heat both frames drew. Air cooling is proportional to heat (specs/heat.md),
// so an unheld tower would be a little cooler on the second frame and the reading
// would be part trip and part ramp; and with the guns held, nothing is fired, so
// no shot is drawn over either frame.
//
// WHY THE HEAT IS RE-POSED AFTER THE TRIP. specs/heat.md makes a trip a state the
// tower enters and leaves what happens to the heat on entering it to the model
// rather than to this check; re-posing the heat after the flag is what guarantees
// the two frames are at the SAME heat whatever the build does with it.
//
// WHY THREE HEATS AND THE WHOLE EMITTER ROSTER. specs/heat.md lets a tripped
// tower sit anywhere below `TRIP_HEAT` while its cooldown runs, so "the same
// heat" is not one heat; a build whose trip look happens to land on its own ramp
// at one point is caught by the other two. And specs/towers.md gives each emitter
// its own figures, so nothing says the six share one ramp or one trip look. The
// Forge and the Sink are not read: specs/towers.md says both carry no heat, and
// specs/heat.md never trips them.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette. Each reading is the colour the footprint MOSTLY is — the mean of its
// largest cluster of pixels (presentation/read.ts) — so a build that marks the
// trip with a wash, a fill, hazard stripes or a shutter all answer, and a build
// that draws the two the same reads zero.
//
// WHAT IT DOES NOT DECIDE. Whether the tower actually TRIPS at 100 is
// `trip.trips-at-100`, what a tripped tower stops doing is the `trip` group's,
// and what the ramp does between heats is `heat-glow-ramp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  sizeOf,
  startRun,
  type Harness,
  type Rgb,
  type TowerType,
} from "../harness";
import { poseStillTower, tripInPlace } from "./pose";
import { EMITTER_TYPES } from "./roster";
import { dominant, footprintRegion, readRegion, showRgb } from "./read";

/**
 * How far the two must sit apart, out of the 441 the RGB cube spans.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. "Unmistakable" in
 * the legibility table reads as at least that and arguably more; the group's own
 * figure is the honest floor, and a build that clears it by a hair has still
 * drawn a tower a player can tell has tripped.
 */
const APART_MIN = 50;

/**
 * How close two pixels of the footprint must be to count as the same reading,
 * when the check asks what the footprint mostly is.
 *
 * Half of `APART_MIN`, and the group's figure for two readings that are the same
 * thing rather than two things: a body shaded across its own area, a gradient, a
 * pixel softened where it meets an outline.
 */
const SAME_READING_MAX = 25;

/**
 * The heats the pair is read at, all of them reachable by a tripped tower.
 *
 * specs/heat.md puts the trip at `TRIP_HEAT` and runs a cooldown from there, so a
 * tripped tower passes down through every heat below it. `TRIP_HEAT - 1` is the
 * hottest a tower can be while still online, so it is the hardest case for a
 * build that leans on the ramp alone, and 20 is the cold end of the cooldown.
 */
const HEATS: readonly number[] = [20, 55, TRIP_HEAT - 1];

/** Which pass leaves the two pictures behind. */
const CAPTURE_TYPE: TowerType = "arc";
const CAPTURE_HEAT = HEATS[1];

/** Where the tower stands: clear of the casing and of both corridors. */
const COL = 12;
const ROW = 8;

/** How far inside the footprint the reading starts, and how dense it is. */
const FOOTPRINT_INSET = 3;
const FOOTPRINT_STEP = 3;

/** The colour the tower's footprint mostly reads as, on the frame just drawn. */
function bodyColor(h: Harness, type: TowerType): Rgb {
  return dominant(
    readRegion(
      h,
      footprintRegion(COL, ROW, sizeOf(type), FOOTPRINT_INSET),
      FOOTPRINT_STEP,
    ),
    SAME_READING_MAX,
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a tripped emitter apart from an online one at the same heat", async () => {
  startRun(h);

  for (const type of EMITTER_TYPES) {
    for (const heat of HEATS) {
      h.debug.clearTowers();
      const id = poseStillTower(h, type, COL, ROW, 0, heat);
      await h.advance(1);
      const shown = type === CAPTURE_TYPE && heat === CAPTURE_HEAT;
      if (shown) captureStill(h, "online");
      const online = bodyColor(h, type);

      tripInPlace(h, id, heat);
      await h.advance(1);
      if (shown) captureStill(h, "tripped");
      const tripped = bodyColor(h, type);

      assertGreaterThanOrEqual(
        colorDistance(online, tripped),
        APART_MIN,
        `a ${type} at heat ${heat}: online (${showRgb(online)}) against the ` +
          `same tower tripped (${showRgb(tripped)}), on the same tile at the ` +
          `same heat, out of 441 (specs/overview.md: a tripped tower reads ` +
          `apart from an online tower at the same heat)`,
      );
    }
  }
});
