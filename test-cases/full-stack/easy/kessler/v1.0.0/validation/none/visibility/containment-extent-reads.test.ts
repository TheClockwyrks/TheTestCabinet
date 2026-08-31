// visibility/containment-extent-reads — the containment circle shows against
// the field it encloses.
//
// WHAT THE SPECIFICATION FIXES. `specs/field.md`: "The containment field is
// the circle of radius `480` that encloses play, drawn so its extent reads at
// a glance." How it is drawn is the build's; what is read is that, around the
// whole circle, the boundary stands apart from the field inside it, against
// the category's figure for clearly apart (`DISTINCT_MIN`, see
// `visibility/distinct.ts`).
//
// THE WORLD THIS POSES. An isolated `playing` field: nothing but what the
// field itself always shows, so every sample reads the build's own field
// drawing and none of the play.
//
// WHERE IT SAMPLES. In each of the four quadrants, five angles; at each angle
// a radial window of five points spanning 474 to 486, so a stroke of any
// reasonable weight centered on 480 lands inside it; and, behind them, the
// open field INSIDE the circle at the same angle — radii 400 and 464, the two
// bands `specs/field.md`'s geometry leaves clear between ring 2, ring 3, and
// the circle. The inside on purpose: the item holds the boundary against the
// field it encloses, and the strip outside the circle near the stage's top
// belongs to the HUD. Each quadrant passes when some window point at some of
// its angles is clearly apart from both field samples at that angle — so a
// dashed or ornamented circle passes, and a circle a quadrant of which shows
// nothing does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { CONTAINMENT_RADIUS } from "../constants";
import {
  captureStill,
  colorDistance,
  isolate,
  openHarness,
  samplePoints,
  type Harness,
} from "../harness";
import { DISTINCT_MIN, polarGrid, polarPoints } from "./distinct";

/** The radial window a stroke centered on 480 lands in. */
const WINDOW_RADII = [474, 477, CONTAINMENT_RADIUS, 483, 486];

/** The open-field bands inside the circle, clear of every drawn annulus. */
const FIELD_RADII = [400, 464];

/** Five angles per quadrant, clear of the axes. */
const QUADRANT_OFFSETS = [25, 35, 45, 55, 65];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the containment circle apart from the field in every quadrant", async () => {
  await isolate(h);
  await h.tick(1);
  await captureStill(h, "scene");

  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    let best = 0;
    for (const offset of QUADRANT_OFFSETS) {
      const theta = quadrant * 90 + offset;
      const window = await samplePoints(
        h,
        polarPoints(polarGrid(WINDOW_RADII, [theta])),
      );
      const field = await samplePoints(
        h,
        polarPoints(polarGrid(FIELD_RADII, [theta])),
      );
      for (const point of window) {
        const apart = Math.min(
          colorDistance(point, field[0]),
          colorDistance(point, field[1]),
        );
        best = Math.max(best, apart);
      }
    }
    assertGreaterThan(
      best,
      DISTINCT_MIN,
      `the RGB separation of the containment circle from the field inside ` +
        `it, across quadrant ${quadrant + 1}`,
    );
  }
});
