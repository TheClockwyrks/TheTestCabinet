// Carom — audio/wall-bounce: a cue sounds on the frame the ball reflects off a
// wall.
//
// The top and bottom edges are the walls; the left and right edges are goals
// (specs/playfield.md), so the ball is fired straight up into the top wall, which
// is the shortest unambiguous wall event there is. The real collision reverses
// its vertical velocity, and the frame that happens on is the frame the cue must
// sound on.
//
// THE FIELD HOLDS THE BALL AND NOTHING ELSE. A wall bounce is about a ball and one
// wall, so both obstacles come off the field and one ball is spawned back; the
// paddles cannot be removed — they are furniture the game always has — so they are
// stood out of the ball's column, and neither is taken from the player, because
// this requirement needs no driven paddle.
//
// WHAT IS OBSERVED. The sound itself, not the synthesis: `audio-init.js` watches a
// Web Audio source being started or an `<audio>` element being played, so a build
// that makes its blips any way at all is read the same. `specs/ui.md` requires one
// cue per event on the frame of the event, which is what the two assertions
// below say. The cue's NAME is not observable from outside an engineless build,
// so this cannot tell a build that plays its scoring blip on a wall apart from one
// that plays the right one; that half is the reviewer's, by ear. The rising flight
// crosses an empty column, so anything that sounds before the reflection is a
// build sounding when nothing happened.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { FIELD_CX } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Where the ball is posed, in logical px down the field's centre line.
 *
 * Far enough below the top wall for half a second of approach, so the clip opens
 * on a ball climbing rather than on one already touching what it reflects off.
 * The column it rises up is clear of both obstacles and of both paddles, so the
 * flight is a straight line and the reflection is the same one a shorter run-up
 * produces — only later, and with something to watch first.
 */
const START_Y = 280;

/**
 * Frames of the descending flight recorded after the reflection.
 *
 * The sweep stops on the frame the vertical velocity reverses, which is the frame
 * the cue must have sounded on and therefore where every reading has to be taken.
 * Recording has no such constraint: the review item promises "the wall bounce
 * whose cue is checked", and a bounce is only legible once the ball is visibly
 * coming back down.
 */
const DESCENT_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds a cue on the frame of the reflection, and not before it", async () => {
  await arrangeLiveBall(h, { x: FIELD_CX, y: START_Y, vx: 0, vy: -500 });
  // A browser opens no audio context without a user gesture, and a build is free
  // to open its own only from a real DOM event. The key is bound to nothing.
  await h.armAudio();

  const played = watchCues(h);
  const bounce = await captureReplay(h, "bounce", async () => {
    const bounced = await h.until((s) => ball0(s).vy > 0, { maxFrames: 120 });
    // Read HERE, on the frame the sweep stopped: the frame number and the sounds
    // emitted by then are exactly what the assertions read before the descent
    // below was recorded.
    const measured = { bounced, frame: h.frame(), cues: [...played] };
    await h.advance(DESCENT_TICKS);
    return measured;
  });

  assertEqual(bounce.bounced.hit, true);
  assertGreaterThan(bounce.cues.length, 0);
  assertDeepEqual(
    bounce.cues.map((cue) => cue.frame),
    bounce.cues.map(() => bounce.frame),
  );
});
