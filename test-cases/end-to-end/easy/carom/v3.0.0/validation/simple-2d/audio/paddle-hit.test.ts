// Carom — audio/paddle-hit: the `paddle-hit` cue plays on the frame the ball
// strikes a paddle.
//
// Cues are the engine's. The game declares the four names `specs/ui.md` fixes and
// asks for one by name; the engine announces every play as a `cue:played` event,
// synchronously, from inside the call. So a check subscribes and reads what
// arrived — there is no log to poll, no audio device to own, and no unlock
// gesture to fake, because a cue is announced whether or not anything could be
// heard.
//
// That the event carries the cue's NAME is what makes this stronger than the
// browser suite it replaces: that suite could only count the sounds a build
// started, so a build that fired its scoring blip on every bounce passed. Here
// the name and the frame are both read, and the frame is the collision's own.

import { afterEach, beforeEach, expect, it } from "vitest";
import { CUES, FIELD_CY } from "../../src/constants";
import {
  arrangePaddleHit,
  createHarness,
  drivePaddleHit,
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

it("plays the paddle-hit cue on the frame of the contact", async () => {
  await startPlaying(h, "versus");
  arrangePaddleHit(h, "left", { cy: FIELD_CY, ballY: FIELD_CY });

  // Subscribed after the scenario is posed, so what is read is the drive alone.
  const played = watchCues(h);
  const contact = await drivePaddleHit(h, "left");
  const frame = h.engine.frame().count;

  expect(contact.hit).toBe(true);
  expect(played.map((cue) => cue.cue)).toEqual([CUES.paddleHit]);
  expect(played[0].frame).toBe(frame);
  expect(played[0].gain).toBeGreaterThan(0);
});
