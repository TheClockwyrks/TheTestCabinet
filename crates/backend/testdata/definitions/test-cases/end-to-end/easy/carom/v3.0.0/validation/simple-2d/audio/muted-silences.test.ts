// Carom — audio/muted-silences: muting silences the cues.
//
// specs/audio.md: "muting silences the cues and changes nothing else". Every
// other point in this category runs unmuted, so this is the one that says what
// the mute bit is FOR. The contact it drives is exactly the one
// `audio/paddle-hit` drives, so the only difference between the two readings is
// the bit.
//
// THE BIT IS POSED, not pressed. `setMuted(muted)` sets it
// (specs/instrumentation.md), so this point is reached through the debug API
// alone and a build whose `m` binding is broken loses `controls-solo/m` and
// `controls-versus/m` and nothing else. It is read back off the snapshot before
// the drive, so a scenario that never armed the bit fails here rather than
// passing on a silence it did not cause.
//
// WHAT SILENCE IS under an engine. The runtime expresses a mute as a SILENT PLAY
// rather than as a play that did not happen: the bus still announces
// `cue:played`, carrying a gain of zero. So what is read here is the gain on
// every cue the drive produced, and not the absence of an event — a check that
// asked for no event at all would fail every conformant build. That the cue
// fires at all is `audio/paddle-hit`'s point.
//
// The whole drive is watched — the approach, the contact, and the return flight
// after it — so a build that deferred its blip by a frame is caught too.
//
// The contact is posed with the standard run-up over a field holding nothing but
// this ball: the struck paddle is still, the far paddle is held out of the lane,
// and both obstacles are off the field, so nothing else can sound.

import { afterEach, beforeEach, it } from "vitest";
import { FIELD_CY } from "../constants";
import { assertEqual } from "../assert";
import {
  LEAD_TICKS,
  arrangePaddleHit,
  captureReplay,
  createHarness,
  drivePaddleHit,
  enterPlaying,
  watchCues,
  type Harness,
} from "../harness";

/** Frames of the return flight recorded after the contact. */
const RETURN_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds nothing on a paddle contact while muted", async () => {
  enterPlaying(h, "versus");
  arrangePaddleHit(h, "left", {
    cy: FIELD_CY,
    ballY: FIELD_CY,
    leadTicks: LEAD_TICKS,
  });

  h.debug.setMuted(true);
  assertEqual(h.snapshot().muted, true);

  // Subscribed after the bit is set, so what is read is the muted drive alone.
  const played = watchCues(h);
  const contact = await captureReplay(h, "muted", async () => {
    const rebound = await drivePaddleHit(h, "left", { leadTicks: LEAD_TICKS });
    await h.advance(RETURN_TICKS);
    return rebound;
  });

  assertEqual(contact.hit, true);
  assertEqual(h.snapshot().muted, true);
  for (const cue of played) {
    assertEqual(cue.gain, 0, `the ${cue.cue} cue is silent while muted`);
  }
});
