// Carom — audio/obstacle-bounce: a cue sounds on the frame the ball bounces off a
// mid-field obstacle.
//
// The ball is fired level with obstacle A, straight at its left face, from far
// enough out that nothing else is in the lane. The real collision reverses its
// horizontal velocity, and the frame that happens on is the frame the cue must
// sound on.
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

import { afterEach, beforeEach, expect, it } from "vitest";
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame of the bounce, and not before it", async () => {
  await startPlaying(h, "versus");
  await h.armAudio();
  await arrangeObstacleBounce(h, {
    faceX: OBSTACLES[0].x0,
    y: OBSTACLE_CENTERS[0].y,
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

  expect(bounce.bounced.hit).toBe(true);
  expect(bounce.cues.length).toBeGreaterThan(0);
  // The 180 px approach crosses an empty lane, so every sound emitted belongs to
  // the collision itself.
  expect(bounce.cues.map((cue) => cue.frame)).toEqual(
    bounce.cues.map(() => bounce.frame),
  );
});
