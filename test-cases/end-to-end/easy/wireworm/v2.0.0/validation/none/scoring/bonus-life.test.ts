// scoring/bonus-life — the score crossing 12,000 through play grants a life.
//
// `specs/scoring.md`, on the bonus life: "One extra life is granted each time the
// score crosses a multiple of `BONUS_LIFE_EVERY` (`12,000`) through play."
//
// THE SCORE IS POSED FIFTY SHORT OF THE MILESTONE and then carried past it by a
// real award. `setScore` is a precondition and grants nothing of its own
// (`specs/instrumentation.md`, and `instrumentation.set-score-grants-no-life` is
// the point that grades that), so the pose puts the run on the near side of
// `12,000` and the head kill — worth `SCORE_HEAD` (`100`), comfortably more than
// the `50` still owed — is what carries it across. That kill is the one crossing
// in the scenario: `12,050` is past `12,000` and nowhere near `24,000`, so
// exactly one multiple is crossed and exactly one life is owed.
//
// THE LIVES ARE READ EITHER SIDE OF THE KILL, not either side of the pose. What
// this point decides is what the CROSSING granted, so the reading brackets the
// crossing; a build that granted a life on the pose instead has broken the pose,
// which is the sibling point's business, and has still not granted one here.
//
// THE WORM IS TWO SEGMENTS, and the bolt takes the head. That leaves a worm
// standing, so the board is not cleared and the level-clear bonus never enters
// the arithmetic (`specs/progression.md`) — a second award could carry the score
// further and, on a build that pays enough, across a second multiple.
//
// The score's arrival past the milestone is asserted first, so a build whose kill
// paid nothing fails naming the kill rather than the bonus life.
//
// WHAT EVERY WRONG MODEL READS. A build that grants a life only on an exact
// multiple grants `0`; one that grants on every award grants `1` here and is
// caught by no point in this direction, which is why the manifest scopes this one
// to the crossing; one that grants a life for each `12,000` the score now HOLDS
// rather than for each crossed grants `1` here too. The figure that fails is
// `0` — no life at all — and it is the one this point exists to catch.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { BONUS_LIFE_EVERY } from "../constants";
import {
  captureStill,
  createHarness,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The head the bolt takes, whose figure carries the score over the milestone. */
const HEAD = { c: 12, r: 8 };

/** The segment behind it, which keeps the board from clearing. */
const TAIL = { c: 13, r: 8 };

/** Heading left, so the chain trails to the right of the head, where it is laid. */
const HEADING = -1;

/** How far short of the milestone the score is posed: `11,950`. */
const SHORT_BY = 50;
const POSED_SCORE = BONUS_LIFE_EVERY - SHORT_BY;

/**
 * The lives the one crossing must grant.
 *
 * There is no tolerance on it and there cannot be one: a life is a whole number
 * and `specs/scoring.md` grants "one extra life" for each multiple crossed, so
 * the assertion is equality.
 */
const EXPECTED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("grants one extra life when a kill carries the score past 12,000", async () => {
  await startPlaying(h);
  await poseWorm(h, {
    c: HEAD.c,
    r: HEAD.r,
    segments: [HEAD, TAIL],
    dh: HEADING,
    stepping: false,
    body: false,
  });
  await h.debug.setScore(POSED_SCORE);

  const before = (await h.snapshot()).lives;
  await shootInto(h, HEAD.c, HEAD.r);

  await captureStill(h, "bonus");
  const after = await h.snapshot();
  assertGreaterThanOrEqual(
    after.score,
    BONUS_LIFE_EVERY,
    "precondition: the kill carried the score past the milestone",
  );
  assertEqual(
    after.lives - before,
    EXPECTED,
    "the lives the crossing of 12,000 granted",
  );
});
