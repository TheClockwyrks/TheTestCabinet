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
//
// The field is emptied down to the climbing ball: both obstacles are REMOVED
// rather than dodged, and the paddles — the single body a check cannot remove —
// are driven out of the mid-field lane, well clear of the centre column the ball
// rises up. So a wall is the only thing the ball can reach, and a build whose
// obstacles are wrong cannot make this point report their defect.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, FIELD_CX } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Where the ball is posed, in logical px down the field's centre line.
 *
 * Far enough below the top wall for half a second of approach, so the clip opens
 * on a ball climbing rather than on one already touching what it reflects off.
 * The field holds nothing else, so the flight is a straight line and the
 * reflection is the same one a shorter run-up produces — only later, and with
 * something to watch first.
 */
const START_Y = 280;

/**
 * Frames of the descending flight recorded after the reflection.
 *
 * The sweep stops on the frame the vertical velocity reverses, which is the frame
 * the cue must have played on and therefore where every reading has to be taken.
 * Recording has no such constraint: the review item promises "the wall bounce
 * whose cue is checked", and a bounce is only legible once the ball is visibly
 * coming back down.
 */
const DESCENT_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the wall-bounce cue on the frame of the reflection", async () => {
  arrangeLiveBall(h, { x: FIELD_CX, y: START_Y, vx: 0, vy: -500 });

  const played = watchCues(h);
  const bounce = await captureReplay(h, "bounce", async () => {
    const bounced = await h.until((s) => ball0(s).vy > 0, { maxFrames: 120 });
    // Read HERE, on the frame the sweep stopped: the frame number and the cues
    // that had sounded by then are exactly what the assertions read before the
    // descent below was recorded.
    const measured = {
      bounced,
      frame: h.engine.frame().count,
      cues: [...played],
    };
    await h.advance(DESCENT_TICKS);
    return measured;
  });

  assertEqual(bounce.bounced.hit, true);
  assertDeepEqual(
    bounce.cues.map((cue) => cue.cue),
    [CUES.wallBounce],
  );
  assertEqual(bounce.cues[0].frame, bounce.frame);
  assertGreaterThan(bounce.cues[0].gain, 0);
});
