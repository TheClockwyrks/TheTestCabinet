// visibility/damaged-target-distinct — a hit ring 2 target does not render as
// an undamaged one.
//
// WHAT THE SPECIFICATION FIXES. `specs/rings.md`: "A ring 2 target that has
// taken a hit is drawn visibly distinct from an undamaged one, so a player
// reads its state at a glance." Ring 2's targets carry 2 hit points, so a
// target at 1 hit point is one that has taken a hit. HOW the damage shows —
// tint, cracks, anything — is the build's, so what is read is that the two
// states render differently, against the category's figure for clearly apart
// (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// THE WORLD THIS POSES. An isolated `playing` field, ring 2 held still
// (`setRingSpeed(2, 0)` — the requirement is a target's look, not the orbit),
// and one target in one slot: first at full hit points, then, after the field
// is cleared, at 1 hit point in the SAME slot. Two renders of the same place,
// so the two reads see the same slot over the same background, and any
// difference is the target's own.
//
// WHERE IT SAMPLES. The same fifteen points of the arc's footprint — three
// radii inside ring 2's annulus (360 to 384) by five angles inside the arc —
// on each render, compared point for corresponding point. The damaged state
// passes when some point of the arc renders clearly apart from the undamaged
// render of that same point.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { ringSpec } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  slotArcCenterDeg,
  type Harness,
} from "../harness";
import {
  DISTINCT_MIN,
  maxCorresponding,
  polarGrid,
  polarPoints,
  samplePoints,
} from "./distinct";

/** Ring 2, slot 6: arc center 146.25 degrees under ring angle 0. */
const RING = 2;
const SLOT = 6;

/** Radii inside ring 2's annulus (360 to 384): 4 in from each edge, and mid. */
const ARC_RADII = [364, 372, 380];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a hit ring 2 target distinct from an undamaged one", async () => {
  isolate(h);
  h.debug.setRingSpeed(RING, 0);

  const arcCenter = slotArcCenterDeg(RING, SLOT, 0);
  const points = polarPoints(
    polarGrid(
      ARC_RADII,
      [-6, -3, 0, 3, 6].map((off) => arcCenter + off),
    ),
  );

  h.debug.spawnTarget(RING, SLOT, ringSpec(RING).hitPoints);
  await h.tick(1);
  captureStill(h, "undamaged");
  const undamaged = samplePoints(h, points);

  h.debug.clearTargets();
  h.debug.spawnTarget(RING, SLOT, ringSpec(RING).hitPoints - 1);
  await h.tick(1);
  captureStill(h, "damaged");
  const damaged = samplePoints(h, points);

  assertGreaterThan(
    maxCorresponding(undamaged, damaged),
    DISTINCT_MIN,
    "the widest RGB distance between the undamaged and the hit render of " +
      "the same ring 2 arc",
  );
});
