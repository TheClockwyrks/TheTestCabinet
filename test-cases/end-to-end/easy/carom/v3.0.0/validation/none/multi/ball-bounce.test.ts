// multi/ball-bounce — a cue sounds on the frame two balls meet.
//
// Two balls are posed level with each other on the mid-field lane, closing head
// on across an empty stretch of field. THE FIELD HOLDS THOSE TWO AND NOTHING
// ELSE: the third ball is off it rather than tucked into a goal channel, and both
// obstacles come off with it, so nothing in the scenario can make a sound but the
// pair. No wall, no paddle and no obstacle is touched between the pose and the
// contact, so a sound emitted on the frame the pair comes apart belongs to the
// pair meeting.
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

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { FIELD_CY } from "../constants";
import {
  captureReplay,
  createMultiHarness,
  placeBall,
  startPlaying,
  watchCues,
  type MultiHarness,
} from "../harness";
import { ballAt, isolateBalls } from "./harness";

/** The two balls the contact is between, in play order. */
const PAIR = [0, 1];

/** The closing speed each ball carries into the contact, in units per second. */
const APPROACH = 400;

/** Where the two balls are posed: level, either side of the field center. */
const LEFT_X = 520;
const RIGHT_X = 760;

/** Frames of the departure recorded after the contact. */
const DEPARTURE_TICKS = 45; // 0.375 s

let h: MultiHarness;

beforeEach(async () => {
  // The one check here reads what the build sounded, so the harness is created
  // armed: a browser opens no audio context without a user gesture, and a build
  // may open its own from a real DOM event alone. The key is pressed before the
  // harness's opening `reset`, so the restore puts back anything it moved and the
  // pair below is posed into an untouched game — only the page's user activation
  // carries over, which is what the build needs to sound at all.
  h = await createMultiHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame the pair meets, and not before it", async () => {
  await startPlaying(h);
  await isolateBalls(h, PAIR);
  await placeBall(h, { x: LEFT_X, y: FIELD_CY, vx: APPROACH }, PAIR[0]);
  await placeBall(h, { x: RIGHT_X, y: FIELD_CY, vx: -APPROACH }, PAIR[1]);

  const played = watchCues(h);
  const meeting = await captureReplay(h, "bounce", async () => {
    const met = await h.until((s) => ballAt(s, PAIR[0]).vx < 0, {
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

  assertEqual(meeting.met.hit, true);
  assertGreaterThan(meeting.cues.length, 0);
  // The approach crosses an empty lane, so every sound emitted belongs to the
  // collision itself.
  assertDeepEqual(
    meeting.cues.map((cue) => cue.frame),
    meeting.cues.map(() => meeting.frame),
  );
});
