// visibility/ball-separates-over-a-target — a ball over a live derelict shows
// against the derelict behind it.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." Each of the three grounds a ball crosses is its own
// point — open field, a live target, and the field near the planet — because a
// build whose ball vanishes over the derelicts alone must grade differently from
// one whose ball vanishes everywhere.
//
// THE WORLD IS ONE LIVE RING-1 TARGET AND THE BALL. Ring 1 is stationary at wave
// 1, so the posed arc stays put and the frame the ball is cleared from shows
// that same arc under the ball's disc — the ball is read against the derelict
// it covers rather than against the empty field. How the reading is taken is
// `ball-presence.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { RINGS } from "../constants";
import {
  isolate,
  openHarness,
  targetArcCenterDeg,
  type Harness,
} from "../harness";
import { ballShowsAt } from "./ball-presence";
import { BALL_POINTS } from "./sampling";

/** Ring 1's slot 6: its arc centers at 195 degrees under ring angle 0. */
const RING = 1;
const SLOT = 6;

/** Most of the disc: a drawn ball moves all five points, a hollow one four. */
const SHOWS_MIN = BALL_POINTS.length - 2;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the ball over a live target it covers", async () => {
  isolate(h);
  const arcCenter = targetArcCenterDeg(RING, SLOT);
  h.debug.spawnTarget(RING, SLOT, RINGS[RING - 1].hitPoints);

  assertGreaterThanOrEqual(
    await ballShowsAt(
      h,
      RINGS[RING - 1].podSpawnRadius,
      arcCenter,
      "over-ring",
    ),
    SHOWS_MIN,
    "the points of a ball's disc over a live target the ball was drawn on",
  );
});
