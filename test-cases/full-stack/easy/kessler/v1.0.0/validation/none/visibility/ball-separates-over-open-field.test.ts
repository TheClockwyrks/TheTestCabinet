// visibility/ball-separates-over-open-field — a ball over open field is never
// the color of the field behind it.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." Each of the three grounds a ball crosses is its own
// point — open field, a live target, and the field near the planet — because a
// build whose ball vanishes over the derelicts alone must grade differently from
// one whose ball vanishes everywhere.
//
// THE WORLD IS AN ISOLATED `playing` FIELD AND THE BALL, and nothing else, so
// what the samples beside it read is the open field itself. How the reading is
// taken is `separation.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { isolate, openHarness, type Harness } from "../harness";
import { DISTINCT_MIN } from "./distinct";
import { separationAt } from "./separation";

/** Out over open field, clear of every ring annulus. */
const BALL_R = 240;
const BALL_THETA = 0;
/** Where the ground beside it is read, at the same radius. */
const BESIDE = [135, 180, 225];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("separates the ball from the open field", async () => {
  await isolate(h);

  assertGreaterThan(
    await separationAt(h, BALL_R, BALL_THETA, BESIDE, "open-field"),
    DISTINCT_MIN,
    "the RGB separation of a ball over open field from the field beside it",
  );
});
