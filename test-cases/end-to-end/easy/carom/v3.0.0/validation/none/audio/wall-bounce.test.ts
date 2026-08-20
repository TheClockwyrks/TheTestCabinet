// Carom — audio/wall-bounce: the `wall-bounce` cue plays on the frame the ball
// reflects off a wall.
//
// The top and bottom edges are the walls; the left and right edges are goals
// (specs/playfield.md), so the ball is fired straight up into the top wall, which
// is the shortest unambiguous wall event there is. The real collision reverses
// its vertical velocity, and the frame that happens on is the frame the cue must
// carry.
//
// The cue's NAME is asserted as well as its arrival: the four cues exist so the
// four events are told apart by ear (specs/ui.md), and a build that plays the
// wrong one on a wall bounce has broken exactly that.

import { afterEach, beforeEach, expect, it } from "vitest";
import { CUES, FIELD_CX } from "../../src/constants";
import {
  arrangeLiveBall,
  createHarness,
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

it("plays the wall-bounce cue on the frame of the reflection", async () => {
  await arrangeLiveBall(h, { x: FIELD_CX, y: 80, vx: 0, vy: -500 });

  const played = watchCues(h);
  const bounced = await h.until((s) => s.ball.vy > 0, { maxFrames: 120 });
  const frame = h.engine.frame().count;

  expect(bounced.hit).toBe(true);
  expect(played.map((cue) => cue.cue)).toEqual([CUES.wallBounce]);
  expect(played[0].frame).toBe(frame);
  expect(played[0].gain).toBeGreaterThan(0);
});
