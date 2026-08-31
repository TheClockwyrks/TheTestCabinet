// visibility/targets-apart-from-field — a live target's arc is not the color
// of the empty ring around it.
//
// WHAT THE SPECIFICATION FIXES. The review item: "A live target's arc stands
// apart from the open field around its ring, so the derelicts to sweep are
// read off the screen." The arc's geometry is `specs/rings.md`'s — ring 1's
// annulus runs 290 to 314, its slot 6's target arc centers at 195 degrees
// under ring angle 0 — and the palette is the build's own, so what is read is
// separation alone, against the category's figure for clearly apart
// (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// THE WORLD THIS POSES. An isolated `playing` field holding exactly one live
// target, on ring 1, which is stationary at wave 1 (`specs/rings.md`), so the
// posed arc stands where the pose put it through the rendered tick.
//
// WHERE IT SAMPLES. Fifteen points across the target's arc — three radii
// inside the annulus by five angles inside the arc — against five points of
// the same annulus at angles whose slots hold no target: the open field
// around its ring, exactly as the item words it. The target passes when some
// point of its arc is clearly apart from every one of those field samples.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { RINGS } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  targetArcCenterDeg,
  type Harness,
} from "../harness";
import {
  DISTINCT_MIN,
  polarGrid,
  polarPoints,
  samplePoints,
  separation,
} from "./distinct";

/** Ring 1, slot 6: arc center 195 degrees under ring angle 0. */
const RING = 1;
const SLOT = 6;

/** Radii inside ring 1's annulus (290 to 314): 4 in from each edge, and mid. */
const ARC_RADII = [294, 302, 310];

/** The same annulus where no target stands: other slots' territory. */
const FIELD_ANGLES = [15, 45, 75, 285, 315];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a live target apart from its ring's open field", async () => {
  isolate(h);
  h.debug.spawnTarget(RING, SLOT, RINGS[RING - 1].hitPoints);
  await h.tick(1);
  captureStill(h, "scene");

  const arcCenter = targetArcCenterDeg(RING, SLOT);
  const arcAngles = [-7, -3.5, 0, 3.5, 7].map((off) => arcCenter + off);

  const target = samplePoints(h, polarPoints(polarGrid(ARC_RADII, arcAngles)));
  const field = samplePoints(h, polarPoints(polarGrid([302], FIELD_ANGLES)));

  assertGreaterThan(
    separation(target, field),
    DISTINCT_MIN,
    "the RGB separation of a live target's arc from the empty annulus " +
      "around its ring",
  );
});
