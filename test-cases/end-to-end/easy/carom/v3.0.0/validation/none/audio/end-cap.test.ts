// Carom — audio/end-cap: the wall-bounce cue sounds on the frame the ball
// reflects off a paddle's end cap.
//
// specs/audio.md gives the `wall-bounce` cue to two events: the top or bottom
// wall, AND a paddle's end cap. `audio/wall-bounce` drives the first; this
// drives the second, because a build that resolves an end cap like a wall in the
// physics and then forgets to sound it fails only this one, which is what says
// where to look.
//
// The ball drops straight down the left paddle's own x span, so the struck face
// is decided by the penetration depths alone (specs/balls.md): the top depth is
// at most one sub-step of travel while the left and right depths are the
// half-span plus BALL_R. The frame the vertical velocity reverses is the frame
// the reflection happened on, and therefore the frame the cue must sound on.
//
// THE FIELD HOLDS THE BALL AND NOTHING ELSE. Both obstacles come off the field
// and one ball is spawned back; the paddles cannot be removed — they are
// furniture the game always has — so the struck one stands at the field centre
// and the far one is parked off the lane. Neither is taken from the player: what
// this needs of the struck paddle is that it STAND still, and in a Versus match
// with no key held it stands exactly where it was put.
//
// WHAT IS OBSERVED. The sound itself, not the synthesis: `audio-init.js` watches
// a Web Audio source being started or an `<audio>` element being played, so a
// build that makes its blips any way at all is read the same. The cue's NAME is
// not observable from outside an engineless build, so this cannot tell a build
// that sounds its scoring blip on a cap apart from one that sounds the right
// one; that half is the reviewer's, by ear. The descent crosses an empty column,
// so anything that sounds before the reflection is a build sounding when nothing
// happened.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { BALL_R, FIELD_CY, P1_X0, P1_X1, PADDLE_HALF } from "../constants";
import {
  PARKED_CY,
  ball0,
  captureReplay,
  createHarness,
  isolateBall,
  placeBall,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

/** The approach, in units per second. */
const SPEED = 400;
/** Where the center rests off the top cap. */
const PLACED = FIELD_CY - PADDLE_HALF - BALL_R;
/** Half a second of approach, so the clip opens on a ball in flight. */
const START_Y = PLACED - SPEED / 2;
/** The middle of the paddle's x span. */
const CAP_X = (P1_X0 + P1_X1) / 2;

/** Frames of the returning flight recorded after the reflection. */
const RETURN_TICKS = 60; // 0.5 s

let h: Harness;

beforeEach(async () => {
  // Armed at creation, because a browser opens no audio context without a user
  // gesture and a build is free to open its own only from a real DOM event.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame of the end-cap reflection, and not before it", async () => {
  await startPlaying(h);
  await isolateBall(h);
  await h.debug.setPaddleCy("left", FIELD_CY);
  await h.debug.setPaddleCy("right", PARKED_CY);
  await placeBall(h, { x: CAP_X, y: START_Y, vy: SPEED });

  // Watched after the scenario is posed, so what is read is the drive alone.
  const played = watchCues(h);
  const bounce = await captureReplay(h, "bounce", async () => {
    const reflected = await h.until((s) => ball0(s).vy < 0, {
      maxFrames: 120,
      poll: 1,
    });
    // Read HERE, on the frame the sweep stopped: the frame number and the sounds
    // emitted by then are exactly what the assertions read before the returning
    // flight below was recorded.
    const measured = { reflected, frame: h.frame(), cues: [...played] };
    await h.advance(RETURN_TICKS);
    return measured;
  });

  assertEqual(bounce.reflected.hit, true);
  assertGreaterThan(bounce.cues.length, 0);
  assertDeepEqual(
    bounce.cues.map((cue) => cue.frame),
    bounce.cues.map(() => bounce.frame),
  );
});
