// visibility/shield-drawn-while-active — an active shield shows a ring at
// radius 92.
//
// WHAT THE SPECIFICATION FIXES. `specs/field.md`: "Shield ring | Circle of
// radius `92`, present while the shield is active", and the review item:
// "While a shield is active the shield ring is drawn at radius 92 around the
// planet." How the ring looks is the build's; what is read is that, with a
// shield active, the band around radius 92 stands apart from the open field
// around the planet — on every side, since a circle "around the planet" is
// not a mark on one side of it — against the category's figure for clearly
// apart (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// THE WORLD THIS POSES. An isolated `playing` field with the shield raised
// through the surface's `setShield(true)` — the pose `specs/instrumentation.md`
// gives for exactly this, so no pod, no catch, and no cue stands between the
// requirement and its read. One tick renders it.
//
// WHERE IT SAMPLES. The shared shield band (see `visibility/shield-band.ts`):
// five angle columns around each cardinal, each a radial window over 86 to 98
// held against the open field at the same angle. Each cardinal's quadrant
// passes when some column of it is clearly apart — so any drawn ring passes
// whatever its ornament, and a ring missing from a whole side does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { DISTINCT_MIN } from "./distinct";
import { SHIELD_ANGLE_OFFSETS, shieldBandColumns } from "./shield-band";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the shield ring against the field on every side", async () => {
  await isolate(h);
  await h.debug.setShield(true);
  await h.tick(1);
  await captureStill(h, "shield-active");

  const columns = await shieldBandColumns(h);
  const perQuadrant = SHIELD_ANGLE_OFFSETS.length;
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const quadrantColumns = columns.slice(
      quadrant * perQuadrant,
      (quadrant + 1) * perQuadrant,
    );
    assertGreaterThan(
      Math.max(...quadrantColumns),
      DISTINCT_MIN,
      `the RGB separation of the active shield's band from the field around ` +
        `the planet, on side ${quadrant + 1} of 4`,
    );
  }
});
