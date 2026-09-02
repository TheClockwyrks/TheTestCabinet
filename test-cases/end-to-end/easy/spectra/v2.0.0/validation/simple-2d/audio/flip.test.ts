// audio/flip — the cue a band flip plays.
//
// `specs/ui.md` fixes `CUES.flip` (`"flip"`) as the cue played when "the ship
// flips its band", and governs all nine with one sentence: "Each is played on the
// frame its event happens and at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave, hold the key
// `specs/controls.md` binds the `b` action to, step one frame at a time, and read
// what the bus announced on the frame the ship's band changed against what it
// announced on the frames before it. The frames before are the half a build cannot
// fake — a build that blips every frame sounds on the flip's frame too, and fails
// on the quiet that should have come first.
//
// THE FLIP IS PRESSED, NOT POSED. `setShipBand` would write the other band without
// the ship ever flipping, and the cue is owed to the flip. So the key is held on
// the engine's own input and the build's own band system decides the rest.
//
// THE WORLD HOLDS THE SHIP ALONE. `startPosed` clears every drone, bullet and
// burst and shuts the three world gates, so nothing but the flip can happen inside
// this window.
//
// WHAT THIS DOES NOT DECIDE. That the flip is instant, or what it costs the
// cannon, which are `bands/flip-instant`'s and `bands/flip-starts-lockout`'s.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Band,
  type Harness,
} from "../harness";
import {
  cuesBeforeEvent,
  cuesOnEvent,
  gainOnEvent,
  quietFrames,
  watchForEvent,
} from "./cues";

/** The first key `specs/controls.md` binds the `b` action to. */
const FLIP_KEY = BINDINGS.b[0];

/** The other of the two bands `specs/bands.md` fixes; there is no third. */
function opposite(band: Band): Band {
  return band === "cyan" ? "magenta" : "cyan";
}

/**
 * Frames of quiet driven before the key goes down.
 *
 * A fifth of a second on the very field the flip is then made on, so "the flip cue
 * did not sound before the flip" is read across a real window rather than an empty
 * one. A build that blips every frame fails on these twenty-four frames.
 */
const QUIET_LEAD = ticksFor(0.2);

/**
 * Frames the press is given to change the ship's band.
 *
 * `specs/bands.md`: "The change is instant: the ship holds the other band in the
 * frame the action is delivered." That is one frame; two more cover the frame the
 * key-down itself is delivered on.
 */
const FLIP_FRAMES = 3;

/** Frames run after the reading, purely so the still shows the flipped ship. */
const TAIL_FRAMES = ticksFor(0.1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.flip on the frame the ship flips its band, and not before", async () => {
  // An empty, quiet, live wave, with the ship on the `cyan` a run opens on
  // (specs/bands.md), so the only thing that can happen in this window is the flip
  // the check makes.
  startPosed(h);
  const before = h.snapshot().ship.band;
  const after = opposite(before);

  const watch = await watchForEvent(
    h,
    (s) => s.ship.band === after,
    QUIET_LEAD + FLIP_FRAMES,
    { quietLead: QUIET_LEAD, arm: () => h.hold(FLIP_KEY) },
  );
  h.release(FLIP_KEY);
  // Held on past the reading, so the still shows the ship settled on its new band.
  // Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "flip");

  assertEqual(
    watch.hit,
    true,
    `the ship held ${after} inside the ${String(FLIP_FRAMES)} frames after the ` +
      `${String(FLIP_KEY)} key went down, the flip being instant (specs/bands.md)`,
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.flip),
    0,
    `times CUES.flip played over the ${String(quietFrames(watch))} frames ` +
      "before the flip, on an empty field where nothing else is happening — a " +
      "cue is played on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.flip),
    1,
    "times CUES.flip played on the frame the ship flipped its band, which is " +
      "its own frame and at most once on it (specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.flip),
    0,
    "the gain the bus announced the flip cue at, nothing here having muted it — " +
      "each of the nine is a distinct short sound a player hears (specs/ui.md)",
  );
});
