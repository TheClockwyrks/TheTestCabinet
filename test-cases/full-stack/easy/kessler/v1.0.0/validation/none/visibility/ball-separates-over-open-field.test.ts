// visibility/ball-separates-over-open-field — a ball over open field shows
// against the field behind it.
//
// `specs/assets.md`'s art bar: "the ball separates from the field at any
// position on the stage." Each of the three grounds a ball crosses is its own
// point — open field, a live target, and the field near the planet — because a
// build whose ball vanishes over the derelicts alone must grade differently from
// one whose ball vanishes everywhere.
//
// THE WORLD IS AN ISOLATED `playing` FIELD AND THE BALL, and nothing else, so
// the frame the ball is cleared from shows the open field alone at those same
// points. How the reading is taken is `ball-presence.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { isolate, openHarness, type Harness } from "../harness";
import { ballShowsAt } from "./ball-presence";
import { BALL_POINTS } from "./sampling";

/** Out over open field, clear of every ring annulus. */
const BALL_R = 240;
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

it("draws the ball over the open field", async () => {
  await isolate(h);

  assertGreaterThanOrEqual(
    await ballShowsAt(h, BALL_R, BALL_THETA, "open-field"),
    SHOWS_MIN,
    "the points of a ball's disc over open field the ball was drawn on",
  );
});
