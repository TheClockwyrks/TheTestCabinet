// Carom — audio/paddle-hit: the `paddle-hit` cue plays on the frame the ball
// strikes a paddle.
//
// Cues are the runtime's. The game declares the four names `specs/ui.md` fixes and
// asks for one by name; the runtime announces every play as a `cue:played` event,
// synchronously, from inside the call. So a check subscribes and reads what
// arrived — there is no log to poll, no audio device to own, and no unlock
// gesture to fake, because a cue is announced whether or not anything could be
// heard.
//
// The event carries the cue's NAME, so a build that fired its scoring blip on
// every bounce is told apart from one that plays `paddle-hit` on a paddle hit:
// the name and the frame are both read, and the frame is the collision's own.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, FIELD_CY } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  LEAD_TICKS,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Frames of the return flight recorded after the contact.
 *
 * `drivePaddleHit` stops on the frame the ball comes off the paddle, which is the
 * frame the cue must have played on and therefore the frame every reading here
 * has to be taken at. It is a bad place to stop RECORDING, though: the review
 * item promises "the paddle hit whose cue is checked", and a hit is the ball
 * arriving, the contact, and the ball leaving. So the readings stay where they
 * were and the departing leg is driven after them, inside the same section.
 */
const RETURN_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the paddle-hit cue on the frame of the contact", async () => {
  await startPlaying(h, "versus");
  // Posed with the standard run-up rather than on the paddle's face, so the clip
  // opens on a ball approaching. The contact is the same one either way: the
  // struck paddle is still (`vy` defaults to zero, so the lead does not move it),
  // the lane is clear of both obstacles and of the far paddle, and the ball
  // arrives at the same point of the same face at the same speed.
  arrangePaddleHit(h, "left", {
    cy: FIELD_CY,
    ballY: FIELD_CY,
    leadTicks: LEAD_TICKS,
  });

  // Subscribed after the scenario is posed, so what is read is the drive alone.
  const played = watchCues(h);
  const contact = await captureReplay(h, "hit", async () => {
    const rebound = await drivePaddleHit(h, "left", { leadTicks: LEAD_TICKS });
    // Read HERE, on the frame the sweep stopped: the frame number and the cues
    // that had sounded by then are exactly what the assertions read before the
    // return flight below was recorded.
    const measured = {
      rebound,
      frame: h.engine.frame().count,
      cues: [...played],
    };
    await h.advance(RETURN_TICKS);
    return measured;
  });

  assertEqual(contact.rebound.hit, true);
  assertDeepEqual(
    contact.cues.map((cue) => cue.cue),
    [CUES.paddleHit],
  );
  assertEqual(contact.cues[0].frame, contact.frame);
  assertGreaterThan(contact.cues[0].gain, 0);
});
