// audio/fire — the cue a shot plays.
//
// `specs/ui.md` fixes `fire` as the cue played when "the ship fires a shot", and
// governs all nine with one sentence: "Each is played on the frame its event
// happens and at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave, hold the fire key, step
// one frame at a time, and read what sounded on the frame the shot left against
// what sounded on the frames before it. The frames before are the half a build
// cannot fake — a build that blips every frame sounds on the shot's frame too,
// and fails on the quiet that should have come first.
//
// THE SHOT IS FIRED, NOT POSED. `addPlayerBullet` would put a bullet on the field
// without the ship ever firing, and the cue is owed to the ship firing. So the
// key `specs/controls.md` binds the `a` action to is held through Chromium's own
// input pipeline and the build's own cannon decides the rest.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `./cues.ts` states why, and what these checks assert instead.
//
// WHAT THIS DOES NOT DECIDE. That a shot leaves at all, or where from, which are
// `ship/*`'s and `controls/fire-space`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { BINDINGS, FIRE_INTERVAL } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  playerBullets,
  startPosed,
  type Harness,
} from "../harness";
import {
  quietFrames,
  soundsBeforeEvent,
  soundsOnEvent,
  watchForEvent,
} from "./cues";

/** The first key `specs/controls.md` binds the `a` action to. */
const FIRE_KEY = BINDINGS.a[0];

/**
 * Frames of quiet driven before the key goes down.
 *
 * A fifth of a second on the very field the shot is then fired from, so "nothing
 * sounded before the shot" is read across a real window rather than an empty one.
 * A build that blips every frame fails on these twenty frames.
 */
const QUIET_LEAD = framesFor(0.2);

/**
 * Frames the held key is given to put a bullet on the field.
 *
 * `specs/ship.md` fires whenever the cooldown, the cap and the lockout allow, and
 * `startPosed` leaves all three clear, so a conforming build fires on the first
 * frame it reads the key down. A build that instead waits out a whole cadence
 * tick still fires inside `FIRE_INTERVAL` (`0.16`), and two frames of slack cover
 * the frame the key-down is delivered on.
 */
const FIRE_FRAMES = framesFor(FIRE_INTERVAL) + 2;

/** Frames run after the reading, purely so the still shows the shot in flight. */
const TAIL_FRAMES = framesFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame the ship fires, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its whole
  // audio layer and is entitled to open it on the player's first interaction
  // alone (`specs/ui.md`), so a shot driven before one would leave a perfectly
  // good build silent. The key is bound to nothing, so this changes no state.
  await h.armAudio();
  // An empty, quiet, live wave: no drone, no bullet and no burst, and the three
  // world gates shut, so the only thing that can happen in this window is the
  // shot the check fires.
  await startPosed(h);

  const watch = await watchForEvent(
    h,
    (s) => playerBullets(s).length > 0,
    QUIET_LEAD + FIRE_FRAMES,
    { quietLead: QUIET_LEAD, arm: () => h.hold(FIRE_KEY) },
  );
  await h.release(FIRE_KEY);
  // Held on past the reading, so the still shows a bullet climbing rather than one
  // still inside the hull. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  await captureStill(h, "shot");

  assertEqual(
    watch.hit,
    true,
    `a shot left the ship inside the ${String(FIRE_FRAMES)} frames after the ` +
      `${String(FIRE_KEY)} key went down, with the cooldown, the cap and the ` +
      "lockout all clear (specs/ship.md)",
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(quietFrames(watch))} frames ` +
      "before the shot, on an empty field where nothing else is happening — a " +
      "cue is played on the frame its event happens (specs/ui.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the frame the shot left the ship, which is the " +
      "frame the fire cue is played on (specs/ui.md)",
  );
});
