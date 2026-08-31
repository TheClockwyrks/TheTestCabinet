// effects/shield-appears-on-catch — catching a shield pod raises the shield
// ring around the planet, drawn at radius 92 and reported as
// effects.shieldActive true.
//
// specs/pods.md: "The catch raises the shield ring around the planet, drawn
// at the radius specs/field.md fixes", and specs/field.md fixes it as the
// "circle of radius `92`, present while the shield is active". The report is
// the exact boolean; the drawing is read as pixels: a circle drawn at radius
// 92 must change what the canvas shows along that circle, so most of twelve
// evenly spaced samples on it must differ visibly (color distance above 10 of
// 255) from the same points before the catch. Four misses are tolerated for
// a build's own dashing or antialiasing along the stroke — but no build can
// draw a circle there that leaves the circle's pixels alone.
//
// THE WORLD IS ONE POD AND THE DEFLECTOR. The emptied field leaves nothing
// moving at radius 92, so between the two readings only the shield can
// change those pixels; the extra settling tick after the catch leaves a
// frame whose render began from the raised shield, whatever the build's
// in-frame draw order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  close,
  colorDistance,
  dropPod,
  open,
  pixelAt,
  record,
  SHIELD_DRAW_RADIUS,
  snap,
  still,
  ticks,
  world,
  type Harness,
  type Rgb,
} from "./pose";

const ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("reports the shield active and draws its ring at radius 92", async () => {
  await world(h);
  await ticks(h, 1);
  assertEqual(
    (await snap(h)).effects.shieldActive,
    false,
    "no shield before the catch",
  );
  const before: Rgb[] = [];
  for (const angle of ANGLES) {
    before.push(await pixelAt(h, SHIELD_DRAW_RADIUS, angle));
  }

  const after = await record(h, "shield-catch", () => dropPod(h, "shield"));
  assertLength(after.pods, 0, "the pod after the catch tick");
  assertEqual(
    after.effects.shieldActive,
    true,
    "effects.shieldActive on the catch",
  );

  await ticks(h, 1);
  await still(h, "shield-ring");
  let changed = 0;
  for (let i = 0; i < ANGLES.length; i++) {
    const now = await pixelAt(h, SHIELD_DRAW_RADIUS, ANGLES[i]);
    if (colorDistance(now, before[i]) > 10) changed += 1;
  }
  assertGreaterThanOrEqual(
    changed,
    8,
    "the ring reads at radius 92 around most of the circle",
  );
});
