// multi/scoring-p1-continues — the field plays on after player one scores.
//
// specs/balls.md: a point in multi takes ONE ball out of play and returns it to
// its own home; it does not return the match to a countdown, because the other
// balls are still in flight. So on the frame the score turns over the screen is
// still `playing`, and that is the rule this variant replaces base's post-point
// countdown with. The mirror is `scoring-p2-continues`.
//
// The same real point `multi/scoring-p1` drives, read for the SCREEN rather than
// for the increment: one ball is aimed at the right goal down an empty lane, the
// other two balls and both obstacles are off the field entirely, and the
// paddles — the one piece of furniture no operation removes — are held clear of
// the lane. So the point that lands is unambiguously the one this check drove.
//
// The increment itself is `multi/scoring-p1`'s point, and that the scored ball
// goes home and holds is `multi-ball/independent-respawn`'s: a build that
// freezes the field on every point is playing base with three balls rather than
// multi, and grading the halves apart is what says which fault a build has.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  enterPlaying,
  type Harness,
} from "../harness";

/** Frames recorded after the point resolves, so the clip shows the field running on. */
const AFTERMATH_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the screen playing when a ball leaves the right goal", async () => {
  enterPlaying(h);
  arrangeGoal(h, "right");

  const point = await captureReplay(h, "playing", async () => {
    const resolved = await h.until((s) => s.score.p1 + s.score.p2 > 0, {
      maxFrames: 360,
      poll: 1,
    });
    await h.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(point.hit, true);
  assertEqual(point.snapshot.screen, "playing");
});
