// visibility/ball-separates-over-a-target — a ball over a live derelict is never
// the color of the derelict behind it.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." Each of the three grounds a ball crosses is its own
// point — open field, a live target, and the field near the planet — because a
// build whose ball vanishes over the derelicts alone must grade differently from
// one whose ball vanishes everywhere.
//
// THE WORLD IS ONE LIVE RING-1 TARGET AND THE BALL. Ring 1 is stationary at wave
// 1, so the posed arc stays put, and the beside-samples sit on the SAME live
// target's arc — the ball is held apart from the derelict it covers rather than
// from the empty field. How the reading is taken is `separation.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { RINGS, ringMidRadius, slotArcCenterDeg } from "../constants";
import { isolate, openHarness, type Harness } from "../harness";
import { DISTINCT_MIN } from "./distinct";
import { separationAt } from "./separation";

/** Ring 1's slot 6: its arc centers at 195 degrees under ring angle 0. */
const RING = 1;
const SLOT = 6;

/** How far to each side the ground beside the ball is read, in degrees. */
const BESIDE_OFF = 8;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("separates the ball from a live target it covers", async () => {
  await isolate(h);
  const arcCenter = slotArcCenterDeg(RING, SLOT);
  await h.debug.spawnTarget(RING, SLOT, RINGS[RING - 1].hp);

  assertGreaterThan(
    await separationAt(
      h,
      ringMidRadius(RING),
      arcCenter,
      [arcCenter - BESIDE_OFF, arcCenter + BESIDE_OFF],
      "over-ring",
    ),
    DISTINCT_MIN,
    "the RGB separation of a ball over a live target from the target's arc " +
      "beside it",
  );
});
