// Carom — audio/scoring: the `score` cue plays on the frame a point is scored.
//
// A real ball is driven out of the right goal, down the mid-field lane that
// clears both obstacles, so the point is scored by the build's own scoring code
// rather than posed. The frame player one's score goes up is the frame the cue
// must carry.
//
// Nothing else may sound on the way. The drive crosses an empty lane, so the
// cues this collects are the point's alone — which is what tells a build that
// announces the point apart from one that plays a bounce blip as the ball leaves
// the field.

import { afterEach, beforeEach, expect, it } from "vitest";
import { CUES } from "../../src/constants";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Frames recorded after the point lands.
 *
 * The sweep stops on the frame the score changes, which is the frame the cue must
 * have played on and therefore where every reading has to be taken. A recording
 * that stopped there would cut on the goal itself: the review item promises "the
 * scored point whose cue is checked", and what tells a reviewer a point was
 * scored is the scoreboard turning over and the next countdown opening.
 */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays the score cue on the frame the point lands", async () => {
  await startPlaying(h, "versus");
  arrangeGoal(h, "right");

  const played = watchCues(h);
  const point = await captureReplay(h, "score", async () => {
    const scored = await h.until((s) => s.score.p1 > 0, { maxFrames: 360 });
    // Read HERE, on the frame the sweep stopped: the frame number and the cues
    // that had sounded by then are exactly what the assertions read before the
    // aftermath below was recorded.
    const measured = {
      scored,
      frame: h.engine.frame().count,
      cues: [...played],
    };
    await h.advance(AFTERMATH_TICKS);
    return measured;
  });

  expect(point.scored.hit).toBe(true);
  expect(point.scored.snapshot.score).toEqual({ p1: 1, p2: 0 });
  expect(point.cues.map((cue) => cue.cue)).toEqual([CUES.score]);
  expect(point.cues[0].frame).toBe(point.frame);
  expect(point.cues[0].gain).toBeGreaterThan(0);
});
