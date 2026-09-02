// waves/resume-runs-the-floor-again — resuming from the pause runs the floor again.
//
// specs/waves.md, Pause and speed: "Resuming continues from exactly there."
// specs/screens.md says the same of the row and the key that do it: `RESUME` leads
// to "`playing`, with the floor exactly as it was left", and "`back` resumes".
// specs/controls.md gives the `pause` action as "Opens the pause screen from live
// play, and RETURNS TO PLAY FROM IT".
//
// THE THIRD LEG THE PAIR IMPLIES. `waves.pause-freezes-the-floor` reads a running
// window and a paused one; a build could pass both by freezing the floor for good.
// This point spends a real paused window and then resumes, and requires the same
// Mote to travel again over a window of the same length.
//
// ================================ THE CLOCK RULE ============================
//
// The measurement is on the clock the player's game runs on and never through a
// stepping operation. Under this engine `engine.advance` is the engine's own frame
// loop running the identical `update` a player's frame runs, so `overWindow` IS
// that clock; what the rule binds is the shape — a window of the same length as the
// one the pause held, bracketed by the one snapshot taken on the press that
// resumed, so the pair spans the resumed window and nothing else. The resume is
// pressed through the key specs/controls.md binds the action to, never posed with
// `setScreen`, which runs no screen entry effect (specs/instrumentation.md).
//
// ============================================================================
//
// THE PAUSED WINDOW IS SPENT BUT NOT ASSERTED ON. It is arrangement: what is being
// resumed has to have been genuinely paused for a stretch, or "resume" means
// nothing. Whether the floor held across it is `waves.pause-freezes-the-floor`'s
// point, so a build with a broken pause and a working resume fails that item and
// passes this one, which is what tells the two apart.
//
// THE UNIT IS A LONE MOTE ON A STRAIGHT OPEN ROW (`waves/run.ts`), with no tower on
// the floor, and the three windows together carry it nowhere near its exhaust.
//
// WHAT EVERY WRONG MODEL READS. A build whose pause key only pauses leaves the
// screen `paused` and the Mote where it stood; one that returns to `playing` with
// its simulation still held travels nothing; one that restarts the run rather than
// resuming has no unit with that id on the floor at all, which the harness reports
// as the entity the build lost.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  overWindow,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { poseMote } from "./run";

/** The key specs/controls.md binds the pause to, which also returns to play. */
const PAUSE_KEY = BINDINGS.pause[0];

/** The length of each window: a second and a half of the build's own clock. */
const WINDOW = ticksFor(1.5);

/**
 * The least the Mote must travel across the resumed window: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`), and the same figure
 * `waves.pause-freezes-the-floor` requires of its running leg so the two legs are
 * read against the same bar. A Mote at its specified `60` logical units per second
 * covers `90` in this window, so the floor is under a quarter of what the
 * specification asks for.
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
  const window = await overWindow(h, WINDOW);

  captureStill(h, "resumed");

  assertEqual(
    paused,
    "paused",
    "precondition: the first press paused the game",
  );
  assertEqual(resumed, "playing", "the screen the second press returned to");
  assertGreaterThan(
    window.travel(mote),
    MIN_TRAVEL,
    "the logical units the Mote walked across the resumed window",
  );
});
