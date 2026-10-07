// audio/discharge — the cue a released discharge plays.
//
// `specs/ui.md` fixes `CUES.discharge` (`"discharge"`) as the cue played when "a
// discharge is released", and governs all nine with one sentence: "Each is played
// on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave with the meter full, hold
// the key `specs/controls.md` binds the `discharge` action to, step one frame at a
// time, and read what the bus announced on the frame the discharge was released
// against what it announced on the frames before it. The frames before are the
// half a build cannot fake — a build that blips every frame sounds on the
// release's frame too, and fails on the quiet that should have come first.
//
// THE RELEASE IS PRESSED, NOT POSED. The surface carries no operation that
// discharges — a discharge is an OUTCOME the game's own rules produce — so the
// meter is filled to the ceiling `specs/resonance.md` states a discharge is
// available at, and the key is held on the engine's own input.
//
// THE FIELD IS LEFT EMPTY, and that is what isolation costs nothing here.
// `specs/resonance.md` has the wave destroy every drone it reaches, and each of
// those kills is a second event; a wave released over an empty field is the
// release alone. Nothing the requirement concerns is left out: the discharge is
// the ship's, and the ship is the one entity no scenario removes.
//
// WHY THE EVENT IS EITHER INDICATOR. `specs/resonance.md` has the action at
// `RESONANCE_MAX` do two things at once: it "sets the meter to `0` and starts the
// wave". A conforming build may report either first, so the frame this check calls
// the release is the first frame on which either is true, which is the frame the
// build acted on.
//
// WHAT THIS DOES NOT DECIDE. What a discharge costs, what its wave reaches, or
// that a meter below full releases nothing, which are `resonance/*`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES, RESONANCE_MAX } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  quietFrames,
  watchForEvent,
} from "./cues";

/** The key `specs/controls.md` binds the `discharge` action to. */
const DISCHARGE_KEY = BINDINGS.discharge[0];

/**
 * Frames of quiet driven before the key goes down.
 *
 * A fifth of a second on the very field the discharge is then released over, so
 * "the discharge cue did not sound before the release" is read across a real
 * window rather than an empty one. A build that blips every frame fails on these
 * twenty-four frames.
 */
const QUIET_LEAD = ticksFor(0.2);

/**
 * Frames the press is given to release the discharge.
 *
 * `specs/controls.md` reads `discharge` as a press edge, once per press, and
 * `specs/resonance.md` has the action spend the meter and start the wave; that is
 * the frame the action is delivered on. Two more frames cover the frame the
 * key-down itself is delivered on.
 */
const RELEASE_FRAMES = 3;

/** Frames run after the reading, purely so the still shows the wave spreading. */
const TAIL_FRAMES = ticksFor(0.15);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.discharge on the frame a discharge is released, and not before", async () => {
  // An empty, quiet, live wave, so the discharge reaches nothing and its release
  // is alone on its frame.
  startPosed(h);
  // The meter at exactly the ceiling, which is where specs/resonance.md says a
  // discharge is available.
  h.debug.setResonance(RESONANCE_MAX);

  const watch = await watchForEvent(
    h,
    (s) => s.discharge.active || s.resonance < RESONANCE_MAX,
    QUIET_LEAD + RELEASE_FRAMES,
    { quietLead: QUIET_LEAD, arm: () => h.hold(DISCHARGE_KEY) },
  );
  h.release(DISCHARGE_KEY);
  // Held on past the reading, so the still shows the wave spreading rather than a
  // circle of zero radius. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "discharge");

  assertEqual(
    watch.hit,
    true,
    `the discharge was released inside the ${String(RELEASE_FRAMES)} frames ` +
      `after the ${String(DISCHARGE_KEY)} key went down, with the meter at ` +
      `${String(RESONANCE_MAX)} (specs/resonance.md)`,
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.discharge),
    0,
    `times CUES.discharge played over the ${String(quietFrames(watch))} frames ` +
      "before the release, on an empty field where nothing else is happening — " +
      "a cue is played on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.discharge),
    1,
    "times CUES.discharge played on the frame the discharge was released, which " +
      "is its own frame and at most once on it (specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.discharge),
    0,
    "the gain the bus announced the discharge cue at, nothing here having muted " +
      "it — each of the nine is a distinct short sound a player hears " +
      "(specs/ui.md)",
  );
});
