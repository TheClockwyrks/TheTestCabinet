// visibility/ball-separates-near-the-planet — a ball near the planet is never
// the color of what lies behind it there.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." Each of the three grounds a ball crosses is its own
// point — open field, a live target, and the field near the planet — because a
// build whose ball vanishes against the planet's glow alone must grade
// differently from one whose ball vanishes everywhere.
//
// THE POSE SITS OUTSIDE THE BURN-UP THRESHOLD of `specs/field.md`, so the ball
// stands to be looked at rather than burning on the tick that renders it. How
// the reading is taken is `separation.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { isolate, openHarness, type Harness } from "../harness";
import { DISTINCT_MIN } from "./distinct";
import { separationAt } from "./separation";

/** Close in on the planet, clear of the 78-unit burn-up threshold. */
const BALL_R = 100;
const BALL_THETA = 0;
/** Where the ground beside it is read, at the same radius. */
const BESIDE = [90, 180];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("separates the ball from the field near the planet", async () => {
  await isolate(h);

  assertGreaterThan(
    await separationAt(h, BALL_R, BALL_THETA, BESIDE, "near-planet"),
    DISTINCT_MIN,
    "the RGB separation of a ball near the planet from the field beside it",
  );
});
