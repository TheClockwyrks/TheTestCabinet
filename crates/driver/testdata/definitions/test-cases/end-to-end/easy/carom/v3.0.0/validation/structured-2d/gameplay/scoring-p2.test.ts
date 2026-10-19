// gameplay/scoring-p2 — a ball crossing the LEFT goal edge scores for player two.
//
// The mirror of `scoring-p1`: the ball is aimed at the left goal down the middle
// lane of an empty field, and the build's own scoring code decides the point.
//
// THE FIELD HOLDS ONE BALL AND NOTHING ELSE. `arrangeGoal` opens live play over
// an isolated field and aims that ball down the middle lane at the goal edge,
// with both paddles held out of it: with the obstacles off the field the flight
// is a straight line, so the point that lands is the one this check aimed and not
// a bank that happened to find a goal.
//
// THE STATE THAT FOLLOWS THE POINT is `gameplay/scoring-p2-countdown`'s: the
// screen returning to the countdown, and the receiver becoming the side that was
// scored on. A build that increments and then leaves the ball where it went out
// is a build that plays one point and stops, which is nothing like a build that
// never scores at all — so the increment is graded here and the restart there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  driveGoal,
  type Harness,
} from "../harness";

/**
 * Frames recorded after the point resolves.
 *
 * `driveGoal` returns on the sample where the screen stops being "playing" — the
 * instant the point lands, which is where the reading has to be taken. Stopping
 * the RECORDING there would cut on the goal itself, so a reviewer would see the
 * ball approach the goal line and never see the scoreboard turn over. Half a
 * second of what follows is what makes the clip show a point being SCORED.
 *
 * Driven after the sweep, inside the same recorded section, so the snapshot the
 * assertions read is still the sweep's own.
 */
const AFTERMATH_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("gives player two the point when the ball leaves the left goal", async () => {
  // Opening a match sets both scores to zero (specs/ui.md), so the point below
  // is the first of the match and the score it produces is a count of one.
  await arrangeGoal(harness, "left");

  const point = await captureReplay(harness, "goal", async () => {
    const resolved = await driveGoal(harness);
    await harness.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(point.hit, true);
  assertEqual(point.snapshot.score.p2, 1);
  assertEqual(point.snapshot.score.p1, 0);
});
