// presentation/heat-glow-ramp — an emitter is drawn differently at the two ends
// of its heat range.
//
// THE RULE. specs/overview.md's legibility table: "An emitter's drawn color
// tracks its heat along a ramp, and the cold end and the near-redline end read
// plainly apart." What a check can decide of that is that the build draws the
// heat AT ALL: the same tower, on the same tile, at the cold end of the range and
// at the near-redline end, is drawn differently. How far apart the two ends read
// and what shape the ramp between them takes are appearance, which the same
// specification hands to the build — "The palette, the type, the glow, and every
// other aspect of the look are yours" — and the reviewer judges.
//
// THE ONE VARIABLE. Both readings are of the SAME tower, on the same tile, at the
// same type, level and rotation, with nothing between them but `setTowerHeat`.
// Everything else the build drew on that patch is identical in the two frames and
// cancels, so what is left is the heat. It holds both faculties
// (presentation/pose.ts), so it fires nothing and cools by nothing, and the heat
// it was posed at is the heat it is carrying on the frame that draws it. How much
// the picture moves on its own is measured first, by reading the same points on
// two frames at the cold end, and the change has to beat that by `NOISE_MARGIN`.
//
// WHERE THE READING IS TAKEN. The body ring of presentation/read.ts, on a Lance,
// whose 4x4 footprint is the roomiest in the roster: the ring sits clear of the
// faces, where specs/towers.md puts the radiator marking, and clear of the
// centre, where specs/hud.md lets a build put a heat read. That last one is why
// the ring and not the whole footprint — a build is free to put its heat read on
// the footprint, `hud.on-floor-heat-read` is the point that grades it, and a
// reading over the whole footprint would pass on that read alone.
//
// WHAT IT DOES NOT DECIDE. Whether a tower is drawn on the FLOOR at all is
// `towers-read-apart-from-the-floor`; whether a tripped tower is drawn apart from
// an online one is `tripped-reads-apart`; and the heat read on the footprint,
// with its marker at the redline, is `hud.on-floor-heat-read`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { sizeOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import type { TowerType } from "../surface";
import { poseStillTower } from "./pose";
import { NOISE_MARGIN, bodyRing, largestShift, readPoints } from "./read";

/**
 * The two heats the body is read at.
 *
 * specs/heat.md puts heat on `0` to `TRIP_HEAT` (`100`), and 99 rather than 100
 * is the top because 100 is the trip's own crossing value and a tower drawn there
 * is what `tripped-reads-apart` is about.
 */
const COLD = 0;
const HOT = 99;

/**
 * The emitter the reading is taken on, and where it stands.
 *
 * The Lance, because its 4x4 footprint is the largest in the roster and so gives
 * the reading the most of the build's own drawing to read. Clear of the vent and
 * exhaust runs specs/floor.md fixes.
 */
const TYPE: TowerType = "lance";
const COL = 15;
const ROW = 24;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws an emitter differently at the two ends of its heat range", async () => {
  startRun(h);
  const id = poseStillTower(h, TYPE, COL, ROW, 0, COLD);
  await h.advance(1);

  const ring = bodyRing(COL, ROW, sizeOf(TYPE));
  const first = readPoints(h, ring);
  await h.advance(1);
  const second = readPoints(h, ring);
  const noise = largestShift(first, second);

  h.debug.setTowerHeat(id, HOT);
  await h.advance(1);
  captureStill(h, "ramp");
  const hot = readPoints(h, ring);

  assertGreaterThanOrEqual(
    largestShift(second, hot),
    noise + NOISE_MARGIN,
    `a ${TYPE} on tile (${COL}, ${ROW}): its body ring is drawn differently ` +
      `at heat ${HOT} from at heat ${COLD}, by more than the ${noise} two ` +
      `frames at heat ${COLD} moved on their own (specs/overview.md: an ` +
      `emitter's drawn color tracks its heat along a ramp, and the cold end ` +
      `and the near-redline end read plainly apart)`,
  );
});
