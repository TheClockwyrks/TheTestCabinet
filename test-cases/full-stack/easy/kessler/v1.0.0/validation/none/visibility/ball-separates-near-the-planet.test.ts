// visibility/ball-separates-near-the-planet — a ball near the planet shows
// against what lies behind it there.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." Each of the three grounds a ball crosses is its own
// point — open field, a live target, and the field near the planet — because a
// build whose ball vanishes against the planet's glow alone must grade
// differently from one whose ball vanishes everywhere.
//
// THE POSE SITS OUTSIDE THE BURN-UP THRESHOLD of `specs/field.md`, so the ball
// stands to be looked at rather than burning on the tick that renders it. How
// the reading is taken is `ball-presence.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { isolate, openHarness, type Harness } from "../harness";
import { ballShowsAt } from "./ball-presence";
import { BALL_POINTS } from "./sampling";

/** Close in on the planet, clear of the 78-unit burn-up threshold. */
const BALL_R = 100;
const BALL_THETA = 0;

/** Most of the disc: a drawn ball moves all five points, a hollow one four. */
const SHOWS_MIN = BALL_POINTS.length - 2;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the ball near the planet", async () => {
  await isolate(h);

  assertGreaterThanOrEqual(
    await ballShowsAt(h, BALL_R, BALL_THETA, "near-planet"),
    SHOWS_MIN,
    "the points of a ball's disc near the planet the ball was drawn on",
  );
});
