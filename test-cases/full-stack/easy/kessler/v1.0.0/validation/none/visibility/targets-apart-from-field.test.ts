// visibility/targets-apart-from-field — a live target's arc is drawn on its
// ring.
//
// WHAT THE SPECIFICATION FIXES. The review item: "A live target's arc is drawn
// on its ring, so the derelicts to sweep are read off the screen." The arc's
// geometry is `specs/rings.md`'s — ring 1's annulus runs 290 to 314, its slot
// 6's target arc centers at 195 degrees under ring angle 0 — and the palette is
// the build's own, so what is read is presence alone: the arc's footprint is
// rendered twice, once with the target standing in the slot and once with the
// targets cleared, and the points that moved between the two frames are the
// points the target was drawn on.
//
// THE WORLD THIS POSES. An isolated `playing` field holding exactly one live
// target, on ring 1, which is stationary at wave 1 (`specs/rings.md`), so the
// posed arc stands where the pose put it through both rendered ticks and the
// second frame reads the same places over the same ring.
//
// WHERE IT SAMPLES. Five angles inside the arc, and at each of them every
// whole radius strictly inside the ring's annulus, so a target drawn as an arc
// of any weight lands on some sampled point at every one of those angles. Each
// angle is read on its own, so a target drawn across only part of its arc does
// not pass on the rest.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { RINGS, slotArcCenterDeg } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  samplePoints,
  type Harness,
  type Rgb,
} from "../harness";
import { movedCount, polarGrid, polarPoints } from "./sampling";

/** Ring 1, slot 6: arc center 195 degrees under ring angle 0. */
const RING = 1;
const SLOT = 6;

/** Every whole radius strictly inside ring 1's annulus (290 to 314). */
const ARC_RADII = Array.from(
  { length: RINGS[RING - 1].outerRadius - RINGS[RING - 1].innerRadius - 1 },
  (_, i) => RINGS[RING - 1].innerRadius + 1 + i,
);

/** Angles inside the 26-degree arc, 6 in from each edge. */
const ARC_OFFSETS = [-7, -3.5, 0, 3.5, 7];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a live target across its arc on the ring", async () => {
  await isolate(h);
  await h.debug.spawnTarget(RING, SLOT, RINGS[RING - 1].hp);
  await h.tick(1);
  await captureStill(h, "scene");

  const arcCenter = slotArcCenterDeg(RING, SLOT);
  const columns = ARC_OFFSETS.map((off) =>
    polarPoints(polarGrid(ARC_RADII, [arcCenter + off])),
  );
  const live: Rgb[][] = [];
  for (const points of columns) live.push(await samplePoints(h, points));

  await h.debug.clearTargets();
  await h.tick(1);
  const cleared: Rgb[][] = [];
  for (const points of columns) cleared.push(await samplePoints(h, points));

  for (let i = 0; i < ARC_OFFSETS.length; i += 1) {
    assertGreaterThan(
      movedCount(live[i], cleared[i]),
      0,
      `the sampled points of ring ${RING}'s annulus at ` +
        `${ARC_OFFSETS[i]} degrees from the arc's center the target was ` +
        `drawn on`,
    );
  }
});
