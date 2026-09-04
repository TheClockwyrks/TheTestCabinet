// gameplay/scoring-p2 — a ball crossing the LEFT goal edge scores for player two.
//
// The mirror of `scoring-p1`: the ball is aimed at the left goal down the
// mid-field lane, and the build's own scoring code decides the point.
//
// The point runs down an isolated lane. `arrangeGoal` empties the field and
// spawns back the one ball it fires, so both obstacles are gone rather than
// dodged, and it drives both paddles out of the mid-field lane — the paddles are
// the one thing on the field a check cannot remove.
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
  enterPlaying,
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
  enterPlaying(harness);
  harness.debug.setScore(0, 0);
  arrangeGoal(harness, "left");

  const point = await captureReplay(harness, "goal", async () => {
    const resolved = await driveGoal(harness);
    await harness.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(point.hit, true);
  assertEqual(point.snapshot.score.p2, 1);
  assertEqual(point.snapshot.score.p1, 0);
});
