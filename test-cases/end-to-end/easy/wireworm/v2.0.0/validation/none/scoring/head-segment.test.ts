// scoring/head-segment — a bolt that destroys a worm's head pays 100.
//
// `specs/scoring.md`'s table: "A bolt destroys a worm's head" pays `SCORE_HEAD`
// (`100`), and "Each figure is paid once, on the event itself."
//
// THE HEAD IS THE FIRST SEGMENT OF THE CHAIN (`specs/worm.md`), so the worm is
// posed head-first and the bolt is fired into that tile. Two segments trail it,
// which is what keeps the board carrying worm segments through the shot: the
// point is decided by the figure alone and never by the level-clear bonus a
// board losing its last segment would pay on top (`specs/progression.md`). A
// bolt into the head "leaves one worm, one segment shorter, led by what was the
// second segment", so the survivors are a worm rather than a cleared board.
//
// WHAT EVERY WRONG MODEL READS. A build that pays the body figure for every
// segment reads `10`; one that pays nothing reads `0`; one that pays for the
// fresh inert node the dead segment leaves behind (`specs/nodes.md`) reads
// `101`. Each is a different number from `100`.
//
// The worm's own faculties are off. This point is about what a shot PAYS, not
// about where a worm walks, so it is posed holding its tiles.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCORE_HEAD } from "../constants";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The head the bolt is fired into: the first segment of the chain. */
const HEAD = { c: 12, r: 8 };

/** The two segments behind it, which survive the shot as a worm of their own. */
const SECOND = { c: 13, r: 8 };
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
const EXPECTED = SCORE_HEAD;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays 100 for a head a bolt destroys", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    segments: [HEAD, SECOND, TAIL],
    dh: HEADING,
    stepping: false,
    body: false,
  });

  const before = (await h.snapshot()).score;
  await shootInto(h, HEAD.c, HEAD.r);

  await captureStill(h, "scored");
  const after = await h.snapshot();
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points a bolt into the head paid",
  );
});
