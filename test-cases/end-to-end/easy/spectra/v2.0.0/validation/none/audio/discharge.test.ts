// audio/discharge — the cue a released discharge plays.
//
// `specs/ui.md` fixes `discharge` as the cue played when "a discharge is
// released", and governs all nine with one sentence: "Each is played on the frame
// its event happens and at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave with the meter full,
// press the key `specs/controls.md` binds the `discharge` action to, step one
// frame at a time, and read what sounded on the frame the discharge was released
// against what sounded on the frames before it. The frames before are the half a
// build cannot fake — a build that blips every frame sounds on the release's
// frame too, and fails on the quiet that should have come first.
//
// THE FIELD IS LEFT EMPTY, and that is deliberate. `specs/resonance.md` has the
// wave destroy every drone it reaches in phase `entering`, `diving` or
// `returning`, and each of those kills plays the `kill` cue. A wave released over
// a populated field would therefore raise two cues within a few frames of each
// other, and under this engine — where a cue's name is unobservable — the reading
// would no longer be about the discharge. An empty field leaves the release alone
// on its frame.
//
// WHY THE EVENT IS EITHER INDICATOR. `specs/resonance.md` has the action at
// `RESONANCE_MAX` do two things at once: it "sets the meter to `0` and starts the
// wave". A conforming build may report either first, so the frame this check
// calls the release is the first frame on which either is true, which is the
// frame the build acted on.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `./cues.ts` states why, and what these checks assert instead.
//
// WHAT THIS DOES NOT DECIDE. What a discharge costs, what its wave reaches, or
// that a meter below full releases nothing, which are `resonance/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { BINDINGS, RESONANCE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";
import {
  quietFrames,
  soundsBeforeEvent,
  soundsOnEvent,
  watchForEvent,
} from "./cues";

/** The key `specs/controls.md` binds the `discharge` action to. */
const DISCHARGE_KEY = BINDINGS.discharge[0];

/**
 * Frames of quiet driven before the key goes down.
 *
 * A fifth of a second on the very field the discharge is then released over, so
 * "nothing sounded before the release" is read across a real window rather than
 * an empty one. A build that blips every frame fails on these twenty frames.
 */
const QUIET_LEAD = framesFor(0.2);

/**
 * Frames the press is given to release the discharge.
 *
 * `specs/controls.md` reads `discharge` as a press edge, "once per press", and
 * `specs/resonance.md` has the action spend the meter and start the wave; that is
 * the frame the action is delivered on. Two more frames cover the frame the
 * key-down itself is delivered on.
 */
const RELEASE_FRAMES = 3;

/** Frames run after the reading, purely so the still shows the wave spreading. */
const TAIL_FRAMES = framesFor(0.15);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame a discharge is released, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its whole
  // audio layer and is entitled to open it on the player's first interaction
  // alone (`specs/ui.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  // An empty, quiet, live wave, so the discharge reaches nothing and its release
  // is alone on its frame.
  await startPosed(h);
  // The meter at exactly the ceiling, which is where `specs/resonance.md` says a
  // discharge is available.
  await h.debug.setResonance(RESONANCE_MAX);

  const watch = await watchForEvent(
    h,
    (s) => s.discharge.active || s.resonance < RESONANCE_MAX,
    QUIET_LEAD + RELEASE_FRAMES,
    { quietLead: QUIET_LEAD, arm: () => h.hold(DISCHARGE_KEY) },
  );
  await h.release(DISCHARGE_KEY);
  // Held on past the reading, so the still shows the wave spreading rather than a
  // circle of zero radius. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  await captureStill(h, "discharge");

  assertEqual(
    watch.hit,
    true,
    `the discharge was released inside the ${String(RELEASE_FRAMES)} frames ` +
      `after the ${String(DISCHARGE_KEY)} key went down, with the meter at ` +
      `${String(RESONANCE_MAX)} (specs/resonance.md)`,
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over the ${String(quietFrames(watch))} frames ` +
      "before the release, on an empty field where nothing else is happening — " +
      "a cue is played on the frame its event happens (specs/ui.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the frame the discharge was released, which is " +
      "the frame the discharge cue is played on (specs/ui.md)",
  );
});
