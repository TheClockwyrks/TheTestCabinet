// audio/inversion — the cue a spectral inversion plays.
//
// `specs/ui.md` fixes `CUES.inversion` (`"inversion"`) as the cue played when "a
// spectral inversion begins", and governs all nine with one sentence: "Each is
// played on the frame its event happens and at most once on that frame."
//
// So the measurement is: pose an empty, quiet, live wave holding ONE diving Prism
// a little above the line it inverts on, let it dive, step one frame at a time,
// and read what the bus announced on the frame the inversion began against what it
// announced over the descent. The descent is the half a build cannot fake — a
// build that blips every frame sounds on the inversion's frame too, and fails on
// the quiet that should have come first.
//
// THE INVERSION IS TRIGGERED, NOT POSED. `setInversion` would put the field into
// an inversion without a Prism ever triggering one, and the cue is owed to the
// trigger. So a Prism is posed in phase `diving` above `PRISM_INVERT_Y` (`640`)
// with its shell intact, and `specs/drones.md`'s own rule — "when a diving Prism
// with a layer still intact has its center cross `PRISM_INVERT_Y` traveling
// downward, it triggers a spectral inversion" — is what fires.
//
// THE PRISM IS POSED WITH TRAVEL ALONE. Its firing is left off, so the two shots
// `specs/drones.md` says a diving Prism takes cannot reach the ship and put a
// second event inside the window; the hull's contact test is left shut by
// `startPosed`, so a dive that crosses the ship's lane costs no life; and the
// wave's dive launching is left shut, so nothing else is pulled into a dive.
//
// WHAT THIS DOES NOT DECIDE. Where the inversion triggers, how long it lasts, what
// it swaps, or the mark the field carries, which are `drones/*`'s,
// `bands/inversion-*`'s and `screens/inversion-overlay`'s.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, PRISM_INVERT_Y } from "../../src/constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseDrone,
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

/** Where the Prism dives: clear of the ship's lane, inside the play field. */
const PRISM_X = 300;

/** The longest a dive runs, in seconds: specs/swarm.md's own ceiling on one. */
const DIVE_MAX_SECONDS = 8;

/**
 * How far above `PRISM_INVERT_Y` the Prism starts, in logical units.
 *
 * Eighty units is a long way short of the line at the stage-1 dive speed of
 * `DIVE_SPEED` (`300`) times `droneSpeedScale(1)` (`1`) — under three tenths of a
 * second of path — so the Prism is posed well inside the stretch of field a dive
 * heading for the bottom has still to cover, and the descent it then flies is the
 * window of quiet this check reads.
 */
const DIVE_LEAD = 80;

/** Where the Prism is placed. */
const PRISM_Y = PRISM_INVERT_Y - DIVE_LEAD;

/**
 * Frames the dive is given to carry the Prism across the line.
 *
 * THE PATH IS THE BUILD'S, so the descent cannot be timed from the eighty units as
 * if it were a fall. `specs/swarm.md` fixes the SPEED a diver travels at
 * (`DIVE_SPEED`) but leaves the shape of the path to the build — "a smooth
 * swooping path of your design" — and a wide arc covers those eighty units of
 * DEPTH over a far longer stretch of path than a plumb line would. Timing this off
 * the depth would quietly demand a steep dive, which the specification never asks
 * for.
 *
 * What the specification DOES bound is the dive itself: "A dive runs no longer
 * than eight seconds." So that is the budget. A Prism that has not crossed
 * `PRISM_INVERT_Y` inside its whole dive, posed eighty units above the line, never
 * reached the bottom of the field on that dive at all.
 */
const DESCENT_FRAMES = ticksFor(DIVE_MAX_SECONDS);

/** Frames run after the reading, purely so the still shows the inverted field. */
const TAIL_FRAMES = ticksFor(0.15);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.inversion on the frame a diving Prism triggers one, and not before", async () => {
  // An empty, quiet, live wave with no inversion running, so the inversion this
  // check reads is the one the Prism triggers.
  startPosed(h);
  // One Prism, shell intact, diving, and travelling — and nothing else. Its firing
  // is off, so the dive cannot put an enemy bullet into the window.
  poseDrone(h, "prism", PRISM_X, PRISM_Y, {
    phase: "diving",
    shell: true,
    travel: true,
    fire: false,
  });

  const watch = await watchForEvent(h, (s) => s.inversionActive, DESCENT_FRAMES);
  // Held on past the reading, so the still shows the field carrying its inversion
  // mark. Nothing after this line can reach an assertion.
  await h.advance(TAIL_FRAMES);
  captureStill(h, "inversion");

  assertEqual(
    watch.hit,
    true,
    `the diving Prism placed ${String(DIVE_LEAD)} units above PRISM_INVERT_Y ` +
      `(${String(PRISM_INVERT_Y)}) crossed it and triggered an inversion inside ` +
      `the ${String(DIVE_MAX_SECONDS)} s a dive runs for (specs/drones.md, ` +
      "specs/swarm.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.inversion),
    0,
    `times CUES.inversion played over the ${String(quietFrames(watch))} frames ` +
      "the Prism descended, on a field where nothing else is happening — a cue " +
      "is played on the frame its event happens (specs/ui.md)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.inversion),
    1,
    "times CUES.inversion played on the frame the inversion began, which is its " +
      "own frame and at most once on it (specs/ui.md)",
  );
  assertGreaterThan(
    gainOnEvent(watch, CUES.inversion),
    0,
    "the gain the bus announced the inversion cue at, nothing here having muted " +
      "it — each of the nine is a distinct short sound a player hears " +
      "(specs/ui.md)",
  );
});
