// multi/ball-bounce — a cue sounds on the frame two balls meet.
//
// Two balls are posed level with each other on the mid-field lane, closing head
// on across an empty stretch of field, and the third is parked in the goal
// channel. Nothing else in the scenario can make a sound: no wall, no paddle and
// no obstacle is touched between the pose and the contact, so a sound emitted on
// the frame the pair comes apart belongs to the pair meeting.
//
// WHAT IS OBSERVED. The sound itself, not the synthesis: `audio-init.js` watches
// a Web Audio source being started or an `<audio>` element being played, so a
// build that makes its blips any way at all is read the same. `specs/ui.md`
// requires one cue per event, on the frame of the event, which is what the two
// assertions below say.
//
// The cue's NAME is not observable from outside an engineless build, so what this
// establishes is that a ball-to-ball collision sounds at all and sounds when it
// happens; whether the five cues are told apart by ear, and whether a frame in
// which a pair meets plays one blip rather than two, is the reviewer's — under an
// engine the bus announces the name and the count, and that is where they are
// read.

import { afterEach, beforeEach, expect, it } from "vitest";
import { FIELD_CY } from "../constants";
import {
  captureReplay,
  clearPaddles,
  createHarness,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { readBalls } from "./harness";

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

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame the pair meets, and not before it", async () => {
  await startPlaying(h);
  await h.armAudio();
  await clearPaddles(h);
  await h.debug.setBall(0, {
    x: LEFT_X,
    y: FIELD_CY,
    vx: APPROACH,
    vy: 0,
    spin: 0,
  });
  await h.debug.setBall(1, {
    x: RIGHT_X,
    y: FIELD_CY,
    vx: -APPROACH,
    vy: 0,
    spin: 0,
  });

  const played = watchCues(h);
  const meeting = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => readBalls(s)[0].vx < 0, {
      maxFrames: 120,
      poll: 1,
    });
    // Read HERE, on the frame the sweep stopped: the frame number and the sounds
    // emitted by then are exactly what the assertions read before the departure
    // below was recorded.
    const measured = { met, frame: h.frame(), cues: [...played] };
    await h.advance(DEPARTURE_TICKS);
    return measured;
  });

  expect(meeting.met.hit).toBe(true);
  expect(meeting.cues.length).toBeGreaterThan(0);
  // The approach crosses an empty lane, so every sound emitted belongs to the
  // collision itself.
  expect(meeting.cues.map((cue) => cue.frame)).toEqual(
    meeting.cues.map(() => meeting.frame),
  );
});
