// Meltdown — waves/resume-runs-the-floor-again: resuming from the pause runs the
// floor again.
//
// `specs/waves.md`, Pause and speed: "Resuming continues from exactly there."
// `specs/screens.md` says the same of the row and the key that do it: `RESUME`
// leads to `playing`, with the floor exactly as it was left, and `back` resumes.
// `specs/controls.md` gives the `pause` action as opening the pause screen from
// live play and RETURNING TO PLAY FROM IT.
//
// THE THIRD LEG THE PAIR IMPLIES. `waves.pause-freezes-the-floor` reads a
// running window and a paused one; a build could pass both by freezing the floor
// for good. This point holds the game paused for a window and then resumes, and
// requires the same Mote to travel again over a window of the same length.
//
// ================================ THE CLOCK RULE ============================
//
// The measurement is on the clock the player's game runs on and never through a
// stepping operation. Under this engine `engine.advance` is the engine's own
// frame loop running the identical frame a player's frame runs, so
// `windowOfFrames` IS that clock (`harness.ts`, Windows on the build's own
// clock); what the rule binds is the shape — a window of the same length as the
// one the pause held, bracketed by the ONE snapshot taken on the press that
// resumed, so the pair spans the resumed window and nothing else. Each window
// is a stated number of frames of a stated length rather than a stretch of wall
// clock, so the same game time lands on any machine. The resume is pressed
// through the key `specs/controls.md` binds the action to, never posed with
// `setScreen`, which runs no screen entry effect (`specs/instrumentation.md`).
//
// ============================================================================
//
// THE PAUSED WINDOW IS SPENT BUT NOT ASSERTED ON. It is arrangement: what is
// being resumed has to have been genuinely paused for a stretch, or "resume"
// means nothing. Whether the floor held across it is
// `waves.pause-freezes-the-floor`'s point, so a build with a broken pause and a
// working resume fails that item and passes this one, which is what tells the
// two apart.
//
// THE UNIT IS A LONE MOTE ON A STRAIGHT OPEN ROW (`waves/run.ts`), with no tower
// on the floor, and the three windows together carry it nowhere near its
// exhaust.
//
// WHAT EVERY WRONG MODEL READS. A build whose pause key only pauses leaves the
// screen `paused` and the Mote where it stood; one that returns to `playing`
// with its simulation still held travels nothing; one that restarts the run
// rather than resuming has no unit with that id on the floor at all, which the
// reading below reports as the unit the build lost.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  windowOfFrames,
  type Harness,
} from "../harness";
import { poseMote, travelled } from "./run";

/** The key `specs/controls.md` binds the pause to, which also returns to play. */
const PAUSE_KEY = BINDINGS.pause[0];

/**
 * The length of each window: a second and a half of the build's own clock, in
 * frames of the suite's.
 *
 * The paused window holds the game paused long enough for the second press to
 * be a resume, and nothing is read off it. The resumed window is the one this
 * item reads: a Mote at its specified `60` logical units per second covers `90`
 * units, four and a half tiles, across it, far more than the bound below. The
 * same frames of the same clock on any machine, so the game time each window
 * covers is the specification's and nothing about the host.
 */
const WINDOW = ticksFor(1.5);

/**
 * The least the Mote must travel across the resumed window: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`), and the same figure
 * `waves.pause-freezes-the-floor` requires of its running leg so the two legs
 * are read against the same bar. A Mote at its specified `60` logical units per
 * second covers `90` across the game time the window names, so the floor is under
 * a quarter of what the specification asks for.
 */
const MIN_TRAVEL = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("walks the same Mote again over a window of the length the pause held", async () => {
  startRun(h);
  const mote = poseMote(h);

  await h.tap(PAUSE_KEY);
  const paused = h.snapshot().screen;
  await h.advance(WINDOW);

  await h.tap(PAUSE_KEY);
  const resumed = h.snapshot().screen;
  const window = await windowOfFrames(h, WINDOW);

  captureStill(h, "resumed");

  assertEqual(
    paused,
    "paused",
    "precondition: the first press paused the game",
  );
  assertEqual(resumed, "playing", "the screen the second press returned to");
  assertGreaterThan(
    travelled(window, mote, "resumed window"),
    MIN_TRAVEL,
    "the logical units the Mote walked across the resumed window " +
      "(specs/waves.md: resuming continues from exactly where the pause left it)",
  );
});
