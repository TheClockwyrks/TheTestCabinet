// multi/ball-bounce — the `ball-bounce` cue plays on the frame two balls meet,
// once for the pair.
//
// Two balls are posed level with each other on the mid-field lane, closing head
// on across an empty stretch of field. The third ball is not on the field at all
// and neither obstacle is: the world holds the pair this point is about and
// nothing else, so what the bus announces on the frame the pair comes apart
// belongs to the pair meeting. The paddles cannot be removed, so both are held
// out of the lane the pair closes along.
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
  openIsolatedPlay,
  parkPaddles,
  watchCues,
  type Harness,
} from "../harness";
import { ballAt, multiOps } from "./harness";

/** How many balls the pair this point is about needs on the field. */
const PAIR = 2;

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
  await openIsolatedPlay(h, { contents: { balls: PAIR } });
  parkPaddles(h);

  const ops = multiOps(h);
  ops.setBallPosition(0, LEFT_X, FIELD_CY);
  ops.setBallVelocity(0, APPROACH, 0);
  ops.setBallSpin(0, 0);
  ops.setBallPosition(1, RIGHT_X, FIELD_CY);
  ops.setBallVelocity(1, -APPROACH, 0);
  ops.setBallSpin(1, 0);

  // Armed AFTER the pose, so the arrangement itself cannot sound into the record.
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
