// multi/ball-bounce — the `ball-bounce` cue plays on the frame two balls meet,
// once for the pair.
//
// Two balls are posed level with each other on the mid-field lane, closing head
// on across an empty stretch of field. Nothing else in the scenario can make a
// sound, because nothing else is ON the field: the third ball and both obstacles
// are removed, and neither ball reaches a wall or a paddle between the pose and
// the contact. So what the bus announces on the frame the pair comes apart
// belongs to the pair meeting — and it belongs to it because there was nothing
// else there, rather than because a spare was parked somewhere it was hoped it
// would stay.
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

import { afterEach, beforeEach, it } from "vitest";
import { CUES, FIELD_CY } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureReplay,
  createHarness,
  enterPlaying,
  poseWorld,
  watchCues,
  type Harness,
} from "../harness";
import { ballAt } from "./harness";

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
  h?.dispose();
});

it("plays the ball-bounce cue once on the frame the pair meets", async () => {
  enterPlaying(h);
  poseWorld(h, { balls: [0, 1] });
  h.multi.setBallPosition(0, LEFT_X, FIELD_CY);
  h.multi.setBallVelocity(0, APPROACH, 0);
  h.multi.setBallSpin(0, 0);
  h.multi.setBallPosition(1, RIGHT_X, FIELD_CY);
  h.multi.setBallVelocity(1, -APPROACH, 0);
  h.multi.setBallSpin(1, 0);

  const played = watchCues(h);
  const meeting = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => ballAt(s, 0).vx < 0, {
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

  assertEqual(meeting.met.hit, true);
  assertDeepEqual(
    meeting.cues.map((cue) => cue.cue),
    [CUES.ballBounce],
  );
  assertEqual(meeting.cues[0].frame, meeting.frame);
  assertGreaterThan(meeting.cues[0].gain, 0);
});
