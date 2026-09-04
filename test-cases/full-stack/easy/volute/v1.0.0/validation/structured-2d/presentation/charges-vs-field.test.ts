// presentation/charges-vs-field — every charge stands apart from the field it is
// drawn on and from the channel plate under it.
//
// THE REQUIREMENT. `specs/overview.md` — "The charges": "Each charge is drawn in
// a color that stands apart from the field, from the channel, and from every
// other charge". This point decides the first two clauses.
// `specs/assets.md` states the same requirement from the plate's side: the
// channel plate is "quiet enough that a core standing on it is the brighter of
// the two", and each core sprite "reads clearly against the channel plate and
// against the field".
//
// WHERE THE TWO GROUNDS ARE READ. The plate patch is 100 units along leg 8 of
// `specs/channel.md`'s polyline, which runs `(220, 220)` to `(620, 220)`, so it
// is plate on a leg no posed core stands on. The field patch is 50 units below
// that, which is as far from the channel as a point on this field can be: the
// polyline's closest parallel legs are 100 units apart. Both are read as the
// mean of a 9 x 9 patch rather than as one pixel, because every edge on the
// field is anti-aliased.
//
// THE BOUND. `DISTINCT_MIN` again — an RGB distance above 50 on the 0-441 scale,
// the case's standing tolerance for two sampled colours told apart. No hex value
// is read: `specs/ui.md` fixes no palette, so the distance between the two
// colours the build chose is the whole of what may be asserted.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_IDS, DISTINCT_MIN } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  samplePatch,
  sampleDisc,
  type Harness,
} from "../harness";
import { FIELD_POINT, PLATE_POINT, poseFiveCharges } from "./charges";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every charge apart from the field and from the plate", async () => {
  await poseFiveCharges(h);
  captureStill(h, "charges");

  const posed = h.snapshot();
  assertEqual(
    posed.train.length,
    CHARGE_IDS.length,
    "the cores one core of each charge put on the channel",
  );

  const field = samplePatch(h, FIELD_POINT.x, FIELD_POINT.y);
  const plate = samplePatch(h, PLATE_POINT.x, PLATE_POINT.y);

  for (const core of posed.train) {
    const colour = sampleDisc(h, core.x, core.y);
    assertGreaterThan(
      colorDistance(colour, field),
      DISTINCT_MIN,
      `the RGB distance from ${core.charge} to the empty field`,
    );
    assertGreaterThan(
      colorDistance(colour, plate),
      DISTINCT_MIN,
      `the RGB distance from ${core.charge} to the bare channel plate`,
    );
  }
});
