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
// for good. This point spends a real paused window and then resumes, and
// requires the same Mote to travel again over a window of the same length.
//
// ================================ THE CLOCK RULE ============================
//
// The measurement is on the clock the player's game runs on and never through a
// stepping operation, so nothing here steps the game either: every window is
// spent by the build's own frame loop against a real-time clock
// (`windowOfRealTime`; `harness.ts`, Windows on the build's own clock). The
// resumed window is the same length as the one the pause held, and it is
// bracketed by the ONE snapshot taken on the press that resumed, so the pair
// spans the resumed window and nothing else. The resume is pressed through the
// key `specs/controls.md` binds the action to, never posed with `setScreen`,
// which runs no screen entry effect (`specs/instrumentation.md`).
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
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureStill,
  clockGain,
  createHarness,
  startRun,
  windowOfClockGain,
  type Harness,
} from "../harness";
import { poseMote, travelled } from "./run";

/** The key `specs/controls.md` binds the pause to, which also returns to play. */
const PAUSE_KEY = BINDINGS.pause[0];

/**
 * The real time the game is HELD PAUSED for before the resume: a second and a
 * half.
 *
 * Nothing is read off it — it only holds the game paused long enough for the
 * second press to be a resume — so its length is a stretch of wall clock and can
 * be. What a busy host does to it is give the loop fewer frames in it, which
 * changes nothing this item asserts.
 */
const HOLD_MS = 1500;

/**
 * The length of the RESUMED window: a second and a half of the BUILD'S OWN clock.
 *
 * The one window this item reads. Nothing steps the game across it — the item is
 * about the floor running again with nobody turning the handle — but a window
 * closed by a STOPWATCH covers however much game time this machine's scheduler let
 * the loop produce, so a travel floor read off it fails a conformant build for the
 * load on the runner. Closed on `simTime` it covers the stretch of the game it
 * names on any machine, and takes longer on a slow one instead of covering less.
 */
const WINDOW_SECONDS = 1.5;

/**
 * The real time the resumed window is given to gain {@link WINDOW_SECONDS}: a
 * minute.
 *
 * A ceiling on the HOST, not a bound on the build — and here a window that never
 * closes is this item's own verdict rather than a precondition, because a floor
 * that does not advance after the resume is exactly what the item looks for.
 */
const WINDOW_DEADLINE_MS = 60_000;

/**
 * The least the Mote must travel across the resumed window: `20` logical units.
 *
 * A floor distance, a little over one `TILE` (`19`), and the same figure
 * `waves.pause-freezes-the-floor` requires of its running leg so the two legs
 * are read against the same bar. A Mote at its specified `60` logical units per
 * second covers `90` across the game time the window names, so the floor is under
 * a quarter of what the specification asks for — and because the window's length
 * is the build's own game time, the figure follows from the specification and from
 * nothing about the machine.
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
  await h.settle(HOLD_MS);

  await h.tap(PAUSE_KEY);
  const resumed = h.snapshot().screen;
  const window = await windowOfClockGain(h, WINDOW_SECONDS, WINDOW_DEADLINE_MS);

  captureStill(h, "resumed");

  assertEqual(
    paused,
    "paused",
    "precondition: the first press paused the game",
  );
  assertEqual(resumed, "playing", "the screen the second press returned to");
  assertTrue(
    window.reached,
    `the seconds the build's own clock gained after the resume, with nothing ` +
      `stepping it, within ${WINDOW_DEADLINE_MS / 1000}s of real time ` +
      `(specs/waves.md: resuming continues from exactly where the pause left it) ` +
      `— it gained ${clockGain(window).toFixed(3)} of the ${WINDOW_SECONDS} asked for`,
  );
  assertGreaterThan(
    travelled(window, mote, "resumed window"),
    MIN_TRAVEL,
    `the logical units the Mote walked across the ${WINDOW_SECONDS} seconds the ` +
      `build's own clock gained after the resume`,
  );
});
