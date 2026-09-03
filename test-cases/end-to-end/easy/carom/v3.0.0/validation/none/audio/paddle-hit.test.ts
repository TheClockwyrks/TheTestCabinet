// Carom — audio/paddle-hit: a cue sounds on the frame the ball strikes a paddle.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD. Under an engine the cue bus
// is the engine's: the game asks for `CUES.paddleHit` BY NAME and the engine
// announces the play, so a check reads the name, the frame and the gain. There is
// no bus here to ask — `specs/overview.md` hands the whole audio layer to the
// build — so what is observed is the sound itself. `audio-init.js` is injected
// before any of the build's script runs and watches the two doors a browser can
// emit sound through: a Web Audio source node being `start()`ed, whatever kind it
// is, and an `<audio>` element being played. Nothing about the waveform, the
// envelope, the duration or the number of sources is assumed, because the
// specification fixes none of them; the reference happens to use one oscillator
// through one gain envelope and nothing here knows that.
//
// WHAT IS THEREFORE ASSERTED. `specs/ui.md` requires one cue per event, played on
// the frame its event happens, from `update`. So: a sound was emitted, it was
// emitted on the frame of the contact, and nothing sounded on the approach. That
// separates a build that plays a cue on the collision from one that plays none,
// one that plays it a frame late, and one that blips every frame. What it cannot
// separate is a build that plays the WRONG cue on the right event, because the
// name is not observable from outside; that half is the reviewer's, by ear.
//
// THE FIELD HOLDS THE CONTACT AND NOTHING ELSE. Both obstacles come OFF the field
// and one ball is spawned back, so no other body on it can make a sound while the
// ball crosses to the paddle. The paddles cannot be removed — they are furniture
// the game always has — so both are taken from the player here, and that is the
// one case where taking them is the requirement rather than a convenience: the
// struck paddle IS the instrument of the contact being measured, and a paddle the
// AI or a stray key could still move would make the reading someone else's. The
// far one is taken at rest and stood out of the lane for the same reason.
//
// AUDIO IS ARMED WITH A REAL KEY FIRST. A browser will not open an audio context
// without a user gesture, and a build is free to open its own only from a genuine
// DOM event. So `armAudio` presses a key through Chromium's own input pipeline —
// one the specification binds to nothing, so arming disturbs no game state.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
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

/**
 * Frames of the return flight recorded after the contact.
 *
 * `drivePaddleHit` stops on the frame the ball comes off the paddle, which is the
 * frame the cue must have sounded on and therefore the frame every reading here
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

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame of the contact, and not before it", async () => {
  await startPlaying(h, "versus");
  await h.armAudio();
  // Posed with the standard run-up rather than on the paddle's face, so the clip
  // opens on a ball approaching. The contact is the same one either way: the
  // struck paddle is still (`vy` defaults to zero, so the lead does not move it),
  // the field holds nothing but this ball, the far paddle is held out of the
  // lane, and the ball arrives at the same point of the same face at the same
  // speed.
  await arrangePaddleHit(h, "left", {
    cy: FIELD_CY,
    ballY: FIELD_CY,
    leadTicks: LEAD_TICKS,
  });

  // Watched after the scenario is posed, so what is read is the drive alone.
  const played = watchCues(h);
  const contact = await captureReplay(h, "hit", async () => {
    const rebound = await drivePaddleHit(h, "left", { leadTicks: LEAD_TICKS });
    // Read HERE, on the frame the sweep stopped: the frame number and the sounds
    // that had been emitted by then are exactly what the assertions read before
    // the return flight below was recorded.
    const measured = { rebound, frame: h.frame(), cues: [...played] };
    await h.advance(RETURN_TICKS);
    return measured;
  });

  assertEqual(contact.rebound.hit, true);
  assertGreaterThan(contact.cues.length, 0);
  // Half a second of approach ran before the contact, across a field holding
  // nothing but this ball, so every sound emitted must belong to the collision.
  assertDeepEqual(
    contact.cues.map((cue) => cue.frame),
    contact.cues.map(() => contact.frame),
  );
});
