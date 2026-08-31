// visibility/ball-separates-from-field — a ball is never the color of what
// lies behind it, wherever it stands.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md`'s art bar: "the ball
// separates from the field at any position on the stage." The review item
// names the three grounds a ball crosses — "over open field, over a ring, and
// near the planet alike" — so each ground is posed and read in turn, the same
// way: the same review, three places. The palette and the ball's own look are
// the build's; what is read is separation alone, against the category's figure
// for clearly apart (`DISTINCT_MIN`, see `visibility/distinct.ts`).
//
// THE WORLD THIS POSES. An isolated `playing` field, plus exactly the ground
// under test: nothing for the open field, one live ring-1 target for "over a
// ring" (ring 1 is stationary at wave 1, so the posed arc stays put), and
// nothing again near the planet. The ball is spawned at rest — motion is
// another category's business — and one tick renders it. A resting ball
// between a ring's contact radii crosses nothing, so no contact resolves.
//
// WHERE IT SAMPLES. Five points inside the ball's 8-unit disc, against the
// ground beside it: the same radius at nearby angles, which is what lies
// behind the ball at that position. Over the ring the beside-samples sit on
// the SAME live target's arc, so the ball is held apart from the derelict it
// covers rather than from the empty field.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { ringSpec } from "../constants";
import {
  captureStill,
  isolate,
  openHarness,
  polarToXy,
  spawnBallPolar,
  slotArcCenterDeg,
  type Harness,
} from "../harness";
import {
  ballGrid,
  DISTINCT_MIN,
  polarGrid,
  polarPoints,
  samplePoints,
  separation,
} from "./distinct";

/** Ring 1's slot 6: its arc centers at 195 degrees under ring angle 0. */
const RING = 1;
const SLOT = 6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Spawn a resting ball at `(r, theta)`, render a tick, and read separation. */
async function separationAt(
  r: number,
  theta: number,
  besideThetas: readonly number[],
  still: string,
): Promise<number> {
  spawnBallPolar(h, r, theta, 0);
  await h.tick(1);
  captureStill(h, still);

  const ball = samplePoints(h, ballGrid(polarToXy(r, theta)));
  const beside = samplePoints(h, polarPoints(polarGrid([r], besideThetas)));
  return separation(ball, beside);
}

it("separates the ball from the open field", async () => {
  isolate(h);

  assertGreaterThan(
    await separationAt(240, 0, [135, 180, 225], "open-field"),
    DISTINCT_MIN,
    "the RGB separation of a ball over open field from the field beside it",
  );
});

it("separates the ball from a live target it covers", async () => {
  isolate(h);
  const arcCenter = slotArcCenterDeg(RING, SLOT, 0);
  h.debug.spawnTarget(RING, SLOT, ringSpec(RING).hitPoints);

  assertGreaterThan(
    await separationAt(
      302,
      arcCenter,
      [arcCenter - 8, arcCenter + 8],
      "over-ring",
    ),
    DISTINCT_MIN,
    "the RGB separation of a ball over a live target from the target's arc " +
      "beside it",
  );
});

it("separates the ball from the field near the planet", async () => {
  isolate(h);

  assertGreaterThan(
    await separationAt(100, 0, [90, 180], "near-planet"),
    DISTINCT_MIN,
    "the RGB separation of a ball near the planet from the field beside it",
  );
});
