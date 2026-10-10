// Carom — audio/obstacle-bounce: a cue sounds on the frame the ball bounces off a
// mid-field obstacle.
//
// The field is emptied and spawned back holding one ball and obstacle A alone,
// and the ball is fired level with that obstacle, straight at its left face. The
// second obstacle is REMOVED rather than reasoned around, so nothing but the body
// under test can produce a sound; the paddles cannot be removed — they are
// furniture the game always has — so they are stood out of the lane, and neither
// is taken from the player, because this requirement needs no driven paddle. The
// real collision reverses the ball's horizontal velocity, and the frame that
// happens on is the frame the cue must sound on.
//
// WHAT IS OBSERVED. The sound itself, not the synthesis: `audio-init.js` watches a
// Web Audio source being started or an `<audio>` element being played, so a build
// that makes its blips any way at all is read the same, and nothing here assumes
// the one oscillator the reference happens to use. `specs/ui.md` requires one cue
// per event, on the frame of the event, which is what the two assertions below
// say.
//
// An obstacle bounce and a paddle hit are different events with different cues,
// and under an engine this is the check that says so — the NAME is read there.
// The name is not observable from outside an engineless build, so what this
// establishes is that the obstacle collision sounds at all and sounds when it
// happens; whether the four cues are told apart by ear is the reviewer's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { OBSTACLES, OBSTACLE_CENTERS } from "../constants";
import {
  arrangeObstacleBounce,
  captureReplay,
  createHarness,
  driveObstacleBounce,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Frames of the departing flight recorded after the bounce.
 *
 * The sweep stops on the frame the ball comes off the obstacle, which is also the
 * frame the cue must have sounded on — so a recording that ended there would hold
 * the approach and the contact and nothing of what the contact produced. The
 * review item promises "the obstacle bounce whose cue is checked", and a bounce a
 * reviewer can hear placed against is one they can see leave the face.
 *
 * Driven after every reading is taken, so nothing recorded here reaches an
 * assertion.
 */
const DEPARTURE_TICKS = 60; // 0.5 s

/** The obstacle the shot strikes: A, the first in the order of `OBSTACLE_CENTERS`. */
const OBSTACLE = 0;

let h: Harness;

beforeEach(async () => {
  // Armed at creation: a build is free to open its audio context from a real DOM
  // event alone, so the harness presses a genuine key as it opens the page. It
  // presses before its opening `reset`, so the restore takes back whatever the
  // press moved and the bounce below is arranged in an untouched game; what is
  // left of the gesture is the user activation, which no reset undoes.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame of the bounce, and not before it", async () => {
  await startPlaying(h, "versus");
  await arrangeObstacleBounce(h, {
    obstacle: OBSTACLE,
    faceX: OBSTACLES[OBSTACLE].x0,
    y: OBSTACLE_CENTERS[OBSTACLE].y,
    from: "left",
  });

  const played = watchCues(h);
  const bounce = await captureReplay(h, "bounce", async () => {
    const bounced = await driveObstacleBounce(h, "left");
    // Read HERE, on the frame the sweep stopped: the frame number and the sounds
    // emitted by then are exactly what the assertions read before the departing
    // flight below was recorded.
    const measured = { bounced, frame: h.frame(), cues: [...played] };
    await h.advance(DEPARTURE_TICKS);
    return measured;
  });

  assertEqual(bounce.bounced.hit, true);
  assertGreaterThan(bounce.cues.length, 0);
  // The 180 px approach crosses a field holding nothing but this ball and the
  // obstacle it is aimed at, so every sound emitted belongs to the collision.
  assertDeepEqual(
    bounce.cues.map((cue) => cue.frame),
    bounce.cues.map(() => bounce.frame),
  );
});
