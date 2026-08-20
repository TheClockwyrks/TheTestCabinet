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
  createHarness,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

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
  const scored = await h.until((s) => s.score.p1 > 0, { maxFrames: 360 });
  const frame = h.engine.frame().count;

  expect(scored.hit).toBe(true);
  expect(scored.snapshot.score).toEqual({ p1: 1, p2: 0 });
  expect(played.map((cue) => cue.cue)).toEqual([CUES.score]);
  expect(played[0].frame).toBe(frame);
  expect(played[0].gain).toBeGreaterThan(0);
});
