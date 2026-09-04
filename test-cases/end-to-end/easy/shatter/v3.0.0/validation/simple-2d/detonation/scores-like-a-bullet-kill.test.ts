// detonation/scores-like-a-bullet-kill — a torpedo kill pays the rock's own figure.
//
// `specs/scoring.md` fixes what a destroyed Large pays and who pays it:
// `SCORE_LARGE` (20), and "Each figure is paid once, on the destruction itself,
// WHATEVER DESTROYED THE BODY." `specs/collision.md` says the same thing from the
// other side — a torpedoed rock "splits and scores exactly as a gun kill of the
// same rock would". So the score a torpedo kill raises is not a figure of its own:
// it is the gun's figure, and this check reads it exactly.
//
// A LARGE RATHER THAN A SMALL, because a Large is where the plausible wrong models
// are furthest apart. A build that pays per HIT rather than per destruction would
// have paid three times for a gun kill and once here; a build that invented a
// torpedo bonus reads above 20; a build that pays the fragment sizes reads 100.
// Every one of them lands on a different number from `SCORE_LARGE`.
//
// EXACT, with no tolerance: `specs/scoring.md` fixes a whole number, and
// `startPlaying` opens the run at a score of `0`, so the reading IS the award. The
// score is read on the tick of the detonation, before anything else on an
// otherwise empty field could add to it.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SCORE_LARGE } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  QUIET_GROUND,
  driveTorpedo,
  inwardHeading,
  launchAt,
} from "./scenario";

/** Ticks run after the reading, so the still shows the score standing on the HUD. */
const AFTERMATH_TICKS = ticksFor(0.4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises the score by exactly SCORE_LARGE when a torpedo takes a Large", async () => {
  startPlaying(h);
  assertEqual(
    h.snapshot().score,
    0,
    "a run opening at a score of 0 (specs/scoring.md)",
  );

  const parentId = poseRock(h, "large", QUIET_GROUND.x, QUIET_GROUND.y);
  const parent = rockById(
    h.snapshot(),
    parentId,
    "the Large the torpedo takes",
  );

  const torpedo = launchAt(
    h,
    { x: parent.x, y: parent.y, radius: ROCK_RADIUS.large },
    inwardHeading(parent),
  );
  const run = await driveTorpedo(h, torpedo);

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "score");

  assertTrue(
    run.hit,
    "the torpedo spent on the Large it was flown into (specs/collision.md)",
  );
  assertEqual(
    run.at.score,
    SCORE_LARGE,
    "the figure a destroyed Large pays, whatever destroyed it (specs/scoring.md)",
  );
});
