// scoring/body-segment — a bolt that destroys a body segment pays 10.
//
// `specs/scoring.md`'s table: "A bolt destroys any other worm segment" —
// anything but the head — pays `SCORE_BODY` (`10`), and "Each figure is paid
// once, on the event itself."
//
// THE WORM IS THREE SEGMENTS, AND THE MIDDLE ONE IS SHOT. Three is the shortest
// chain that has a segment which is neither the head nor the tail, so the tile
// the bolt resolves against is unambiguously a body segment. The two survivors
// are what keep the board carrying worm segments through the shot, so the point
// is decided by the figure alone and never by the level-clear bonus a board
// losing its last segment would pay on top (`specs/progression.md`).
//
// WHAT EVERY WRONG MODEL READS. A build that pays the head figure for any
// segment reads `100`; one that pays the discharge's purge figure reads `5`; one
// that pays for the fresh inert node the dead segment leaves behind
// (`specs/nodes.md`) reads `11`; one that pays nothing reads `0`. Each is a
// different number from `10`, so a failure names the model the build implemented.
//
// The worm's own faculties are off. This point is about what a shot PAYS, not
// about where a worm walks, so it is posed holding its tiles.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_BODY } from "../constants";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The head, which this point does not shoot. */
const HEAD = { c: 12, r: 8 };

/** The body segment the bolt is fired into: neither the head nor the tail. */
const MIDDLE = { c: 13, r: 8 };

/** The tail, which survives alongside the head-side run. */
const TAIL = { c: 14, r: 8 };

/** Heading left, so the chain trails to the right of the head, where it is laid. */
const HEADING = -1;

/**
 * What the shot must pay, to the point.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = SCORE_BODY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 10 for a body segment a bolt destroys", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    segments: [HEAD, MIDDLE, TAIL],
    dh: HEADING,
    stepping: false,
    body: false,
  });

  const before = (await h.snapshot()).score;
  await shootInto(h, MIDDLE.c, MIDDLE.r);

  await captureStill(h, "scored");
  const after = await h.snapshot();
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points a bolt into a body segment paid",
  );
});
