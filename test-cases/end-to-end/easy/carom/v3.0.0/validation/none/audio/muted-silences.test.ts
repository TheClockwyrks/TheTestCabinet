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
// WHAT IS OBSERVED under `none` is the sound itself: the probe watches a Web
// Audio source being started or an `<audio>` element being played, so a build
// that makes its blips any way at all is read the same. That NO sound may start
// is what specs/audio.md states for an engineless build — "while the bit is set
// the game starts no sound at all: a muted game plays nothing, rather than
// playing at zero volume" — so a build that keeps synthesizing at zero gain is
// not conformant here and the reading is the spec's, not the probe's limits.
// The whole drive is watched — the approach, the contact, and the return flight
// after it — so a build that deferred its blip by a frame is caught too.
//
// The contact is posed with the standard run-up over a field holding nothing but
// this ball: the struck paddle is still, the far paddle is held out of the lane,
// and both obstacles are off the field, so nothing else can sound.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { FIELD_CY } from "../constants";
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

/** Frames of the return flight recorded after the contact. */
const RETURN_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  // Armed at creation, so the page carries the user activation a build needs to
  // make a sound at all: a silence this check reads must be the mute bit's and
  // not the browser's.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds nothing on a paddle contact while muted", async () => {
  await startPlaying(h, "versus");
  await arrangePaddleHit(h, "left", {
    cy: FIELD_CY,
    ballY: FIELD_CY,
    leadTicks: LEAD_TICKS,
  });

  await h.debug.setMuted(true);
  assertEqual((await h.snapshot()).muted, true);

  // Watched after the bit is set, so what is read is the muted drive alone.
  const played = watchCues(h);
  const contact = await captureReplay(h, "muted", async () => {
    const rebound = await drivePaddleHit(h, "left", { leadTicks: LEAD_TICKS });
    await h.advance(RETURN_TICKS);
    return rebound;
  });

  assertEqual(contact.hit, true);
  assertEqual((await h.snapshot()).muted, true);
  assertLength(played, 0);
});
