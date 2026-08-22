// multi/ball-bounce — the `ball-bounce` cue plays on the frame two balls meet,
// once for the pair.
//
// Two balls are posed level with each other on the mid-field lane, closing head
// on across an empty stretch of field, and the third is parked in the goal
// channel. Nothing else in the scenario can make a sound: no wall, no paddle and
// no obstacle is touched between the pose and the contact, so what the bus
// announces on the frame the pair comes apart belongs to the pair meeting.
//
// A ball-to-ball bounce and every other collision in this game are different
// events with different cues, and this is the check that says so: the name
// asserted here is the pair's, and a build that reuses one blip for every bounce
// fails it.
//
// The COUNT is the other half. A collision is one event between two balls, so the
// frame a pair meets plays the cue once for the pair — the implementation that
// walks the balls and sounds on each side of the contact double-fires, and the
// single-element list below is what catches it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { CUES, FIELD_CY } from "../../src/constants";
import {
  captureReplay,
  clearPaddles,
  createHarness,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { readBalls } from "./harness";

/** The closing speed each ball carries into the contact, in units per second. */
const APPROACH = 400;

/** Where the two balls are posed: level, either side of the field center. */
const LEFT_X = 520;
const RIGHT_X = 760;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 45; // 0.375 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays the ball-bounce cue once on the frame the pair meets", async () => {
  await startPlaying(h);
  clearPaddles(h);
  h.debug.setBall(0, {
    x: LEFT_X,
    y: FIELD_CY,
    vx: APPROACH,
    vy: 0,
    spin: 0,
  });
  h.debug.setBall(1, {
    x: RIGHT_X,
    y: FIELD_CY,
    vx: -APPROACH,
    vy: 0,
    spin: 0,
  });

  const played = watchCues(h);
  const meeting = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => readBalls(s)[0].vx < 0, {
      maxFrames: 120,
      poll: 1,
    });
    // Read HERE, on the frame the sweep stopped: the cues that had sounded by
    // then are exactly what the assertions read before the departure below was
    // recorded.
    const measured = {
      met,
      frame: h.engine.frame().count,
      cues: [...played],
    };
    await h.advance(DEPARTURE_TICKS);
    return measured;
  });

  expect(meeting.met.hit).toBe(true);
  expect(meeting.cues.map((cue) => cue.cue)).toEqual([CUES.ballBounce]);
  expect(meeting.cues[0].frame).toBe(meeting.frame);
  expect(meeting.cues[0].gain).toBeGreaterThan(0);
});
