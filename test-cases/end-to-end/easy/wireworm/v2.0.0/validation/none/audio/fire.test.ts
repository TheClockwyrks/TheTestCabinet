// audio/fire — firing a bolt sounds a cue on the frame the bolt appears, and the
// quiet board before it stays silent.
//
// `specs/ui.md`'s cue table: `fire` is played when "A bolt is fired", and every
// cue "is played on the frame its event happens and at most once on that frame".
// `specs/cursor.md` fixes when that frame is: "a bolt is fired whenever the
// cooldown is at `0` and fewer than `MAX_BOLTS` bolts are in flight", so the
// frame the fire cue belongs to is the frame the bolt appears on.
//
// WHAT IS AND IS NOT OBSERVABLE HERE is the whole of `audio/cues`' module
// comment; the short of it is that a sound and its frame can be read from
// outside an engineless build and a cue's NAME cannot, so this point separates a
// build that cues the shot from one that cues nothing, one that cues a frame
// late, and one that blips every frame — and leaves which of the ten sounds it
// played to the reviewer's ear.
//
// THE WORLD THIS POSES. `startPlaying` leaves an empty board — no node, no worm,
// no foe, no bolt — with the three world gates shut and the cursor at the band's
// centre with its cooldown at `0`. Nothing on that board can raise any of the
// other nine cues, so every sound the drive emits belongs to the shot. The board
// is driven for a third of a second BEFORE the action is held, so a build that
// blips per frame has somewhere to fail that is not the shot itself.
//
// The key is a real one, held through Chromium's own input pipeline and released
// the moment the bolt exists, so the whole path from the physical key to the
// sound is exercised and exactly one bolt is fired.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  watchCues,
  type Harness,
} from "../harness";
import { fireBolt, framesOtherThan, soundsOn } from "./cues";

/**
 * Quiet play driven before the action is held, in frames.
 *
 * A third of a second of a board that raises no event at all. It is not a
 * tolerance on anything: it is how much silence a build that blips per frame has
 * to get through before the shot it is allowed to sound on.
 */
const QUIET_FRAMES = framesFor(0.3);

/**
 * Flight driven after the readings are taken, so the still shows a bolt climbing.
 *
 * The review item's evidence is "the shot whose cue is read", and a shot is the
 * bolt appearing and then travelling. Every assertion below reads values
 * captured before this ran.
 */
const FLIGHT_FRAMES = framesFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("sounds on the frame the bolt appears, and on no other frame", async () => {
  await startPlaying(h);
  await h.armAudio();

  // Watched after the board is posed, so what is read is the drive alone.
  const played = watchCues(h);
  await h.advance(QUIET_FRAMES);

  const fired = await fireBolt(h);
  // Read HERE, on the frame the bolt appeared: the frame number and the sounds
  // emitted by then are exactly what the assertions below read.
  const shotFrame = h.frame();
  const heard = [...played];

  await h.advance(FLIGHT_FRAMES);
  await captureStill(h, "shot");

  assertEqual(fired.hit, true, "the held fire action to put a bolt in flight");
  assertGreaterThan(
    soundsOn(heard, shotFrame),
    0,
    `sounds emitted on frame ${shotFrame}, the frame the bolt appeared`,
  );
  assertDeepEqual(
    framesOtherThan(heard, shotFrame),
    [],
    "the frames of every sound emitted away from the shot",
  );
});
