// visibility/containment-extent-reads — the containment circle shows against
// the field it encloses.
//
// WHAT THE SPECIFICATION FIXES. `specs/field.md`: "The containment field is
// the circle of radius `480` that encloses play, drawn so its extent reads at
// a glance." How it is drawn is the build's; what is read is presence alone:
// that, around the whole circle, something is drawn on the boundary that the
// bare field inside it does not carry. The circle is always drawn, so what the
// boundary is read against is the ground beside it rather than a frame without
// it.
//
// THE WORLD THIS POSES. An isolated `playing` field: nothing but what the
// field itself always shows, so every sample reads the build's own field
// drawing and none of the play.
//
// WHERE IT SAMPLES. In each of the four quadrants, the 40 degrees from 25 to
// 65 past its axis, clear of the axes and of the HUD's strip across the top of
// the stage; at angle columns one unit of arc apart, and at each column a
// radial window of unit-spaced points spanning 474 to 486. Together those meet
// every pixel of the band, so a stroke of any weight, a dash, or a dot centered
// near 480 lands on a sampled point wherever it lies. Behind each column, the
// open field INSIDE the circle at the same angle — radii 400 and 464, the two
// bands `specs/field.md`'s geometry leaves clear between ring 2, ring 3, and
// the circle. The inside on purpose: the item holds the boundary against the
// field it encloses, and the strip outside the circle near the stage's top
// belongs to the HUD. A column is drawn on when some window point in it
// differs from both field samples at its angle.
//
// THE FLOOR. A quadrant passes when more than `BOUNDARY_MIN_COLUMNS` of its
// columns are drawn on. The band is read pixel by pixel, so a speck of the
// build's own starfield that happens to sit inside it marks a column or two of
// the roughly 330 per quadrant; the floor tolerates a few such specks and
// still fails a quadrant of the circle that shows nothing, while a stroke, a
// dash pattern, or a dot pattern covering one part in twenty-five of the arc
// clears it. A tolerance, not a figure any requirement states.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { FIELD_RADIUS } from "../constants";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import {
  drawnOver,
  polarGrid,
  polarPoints,
  samplePoints,
  unitArcAngles,
  unitRadii,
} from "./sampling";

/** The radial window a stroke centered on 480 lands in, one unit apart. */
/** The window's inner edge, the radius its angle spacing is sized for. */
const WINDOW_INNER = FIELD_RADIUS - 6;

const WINDOW_RADII = unitRadii(WINDOW_INNER, FIELD_RADIUS + 6);

/** The open-field bands inside the circle, clear of every drawn annulus. */
const FIELD_RADII = [400, 464];

/** The span of each quadrant that is read, in degrees past its axis. */
const QUADRANT_SPAN = { from: 25, to: 65 };

/** How many drawn-on columns a quadrant must show beyond the noise floor. */
const BOUNDARY_MIN_COLUMNS = 12;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the containment circle apart from the field in every quadrant", async () => {
  isolate(h);
  await h.tick(1);
  captureStill(h, "scene");

  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const axis = quadrant * 90;
    const thetas = unitArcAngles(
      axis + QUADRANT_SPAN.from,
      axis + QUADRANT_SPAN.to,
      WINDOW_INNER,
    );
    let drawn = 0;
    for (const theta of thetas) {
      const window = samplePoints(
        h,
        polarPoints(polarGrid(WINDOW_RADII, [theta])),
      );
      const field = samplePoints(
        h,
        polarPoints(polarGrid(FIELD_RADII, [theta])),
      );
      if (drawnOver(window, field) > 0) drawn += 1;
    }
    assertGreaterThan(
      drawn,
      BOUNDARY_MIN_COLUMNS,
      `the angle columns of the radius-480 boundary carrying something the ` +
        `field inside it does not, of the ${thetas.length} read across ` +
        `quadrant ${quadrant + 1}`,
    );
  }
});
