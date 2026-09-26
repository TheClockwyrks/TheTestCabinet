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
// WHAT IS DECIDED, AND WHERE THE BAR COMES FROM. specs/overview.md fixes no
// palette, and in particular it does not say a tripped tower is red — how
// unmistakable the trip looks is the reviewer's to judge. What is decided here is
// that the build drew something for it: the same body ring on the same tile,
// online and tripped, so a build that marks the trip with a wash, a fill, hazard
// stripes or a shutter all answer. How far that ring moves on its own is
// measured, by reading it on two frames while the tower is online, and the trip
// has to beat that by `NOISE_MARGIN`. The ring rather than the whole footprint,
// because specs/hud.md lets a build put its heat read on the footprint and
// `hud.on-floor-heat-read` is the point that grades it.
//
// WHAT IT DOES NOT DECIDE. Whether the tower actually TRIPS at 100 is
// `trip.trips-at-100`, what a tripped tower stops doing is the `trip` group's,
// and what the ramp does between heats is `heat-glow-ramp`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { TRIP_HEAT } from "../constants";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { poseStillTower, tripInPlace } from "./pose";
import { EMITTER_TYPES } from "./roster";
import {
  NOISE_MARGIN,
  bodyRing,
  largestShift,
  readPoints,
  type Point,
} from "./read";

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

/** The ring inside a tower's body every reading here is taken on. */
function ringOf(type: TowerType): Point[] {
  return bodyRing(COL, ROW, sizeOf(type));
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
      const ring = ringOf(type);
      await h.advance(1);
      const shown = type === CAPTURE_TYPE && heat === CAPTURE_HEAT;
      const first = readPoints(h, ring);
      await h.advance(1);
      if (shown) captureStill(h, "online");
      const online = readPoints(h, ring);
      const noise = largestShift(first, online);

      tripInPlace(h, id, heat);
      await h.advance(1);
      if (shown) captureStill(h, "tripped");
      const tripped = readPoints(h, ring);

      assertGreaterThanOrEqual(
        largestShift(online, tripped),
        noise + NOISE_MARGIN,
        `a ${type} at heat ${heat}: its body ring is drawn differently once ` +
          `the tower trips, on the same tile at the same heat, by more than ` +
          `the ${noise} two frames of it running moved on their own ` +
          `(specs/overview.md: a tripped tower reads apart from an online ` +
          `tower at the same heat)`,
      );
    }
  }
});
