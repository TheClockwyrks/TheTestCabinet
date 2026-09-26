// waves/resume-runs-the-floor-again — resuming a paused game runs the floor
// again.
//
// `specs/waves.md`, Pause and speed: "Resuming continues from exactly there."
// `specs/screens.md` gives the pause screen's `RESUME` row and `back` the same
// effect, "`playing`, with the floor exactly as it was left", and
// `specs/controls.md` gives the `pause` action both halves: it "Opens the pause
// screen from live play, and returns to play from it".
//
// THE THIRD LEG THE PAUSE PAIR IMPLIES, AND ITS OWN ITEM. A build that freezes
// the floor and never thaws it satisfies `waves/pause-freezes-the-floor`
// perfectly and leaves the player with a dead game — a defect that item cannot
// see, because it never resumes. So this one reads the resume alone, and reads it
// in one direction: the floor moved again.
//
// THREE WINDOWS OF THE SAME LENGTH, each a stated number of frames driven through
// `advance` rather than a stretch of real time, so the same game time lands on any
// machine. The first is running and the second paused, and neither is asserted
// here — they are `waves/pause-freezes-the-floor`'s readings. What they are for
// is the PRECONDITION: the game must actually have been paused when the second
// press arrived, or "resuming" is not what this check did. That precondition is
// the screen the pause left behind, and nothing else about those two windows is
// graded, so a build that fails the freeze can still pass the thaw and be told
// apart. Both presses are real keys delivered through Chromium and held across
// one frame.
//
// THE TRAVEL IS READ FROM THE SNAPSHOT TAKEN ON THE PRESS THAT RESUMED to the one
// taken at the end of the resumed window, so the leg measured begins where the
// freeze ended.
//
// AND THE SCREEN THE SECOND PRESS LANDED ON IS READ TOO. `specs/screens.md` makes
// the resume's destination `playing` by name, so a build that moved the floor
// again while leaving the pause screen standing over it — or that sent the second
// press to the title — has not resumed the run even though the Mote walked. The
// travel says the simulation runs; the screen says the player is back in it.
//
// THE FLOOR HOLDS ONE MOTE AND NOTHING ELSE, and three windows carry it about
// fourteen tiles down a forty-nine-tile corridor (`specs/floor.md`), so it never
// reaches its exhaust and no leak interrupts the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  framesFor,
  requireUnit,
  startRun,
  tapAction,
  type Harness,
} from "../harness";
import { poseRunningFloor } from "./run";

/**
 * The game time each window covers: a second and a half, in frames of the
 * suite's `120` Hz clock.
 *
 * Geometry rather than a tolerance. A Mote's specified `60` logical units per
 * second (`specs/surge.md`) carries it `90` units, four and a half tiles, across
 * that much game time — far more than the bound below.
 */
const WINDOW_SECONDS = 1.5;
const WINDOW_FRAMES = framesFor(WINDOW_SECONDS);

/**
 * How far the Mote must travel in the resumed window: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in {@link WINDOW_SECONDS} of
 * game time: a build that walks at a third of its specified pace still clears it.
 * It is the same figure the running leg of `waves/pause-freezes-the-floor` is held
 * to, because it is the same claim — that the floor is advancing — read after a
 * resume rather than before a pause.
 */
const PAUSE_MIN_TRAVEL = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("walks the same Mote again once the pause is lifted", async () => {
  await startRun(h);
  const mote = await poseRunningFloor(h);

  await h.advance(WINDOW_FRAMES);
  await tapAction(h, "pause");
  await h.advance(WINDOW_FRAMES);
  const held = await h.snapshot();
  await tapAction(h, "pause");
  // The snapshot the resumed window is measured from: the one taken on the press
  // that lifted the freeze.
  const resumedAt = await h.snapshot();
  await h.advance(WINDOW_FRAMES);
  const resumed = await h.snapshot();

  await captureStill(h, "resumed");

  assertEqual(
    held.screen,
    "paused",
    "precondition: the first press paused the game, so the second one resumes it",
  );
  assertEqual(
    resumed.screen,
    "playing",
    "the screen the second press returned to (specs/screens.md: RESUME goes to `playing`, with the floor exactly as it was left)",
  );
  assertGreaterThan(
    distance(
      requireUnit(resumedAt, mote, "the resumed window"),
      requireUnit(resumed, mote, "the resumed window"),
    ),
    PAUSE_MIN_TRAVEL,
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled across the ${WINDOW_SECONDS} seconds of the resumed window (specs/waves.md: resuming continues from exactly where the pause left it)`,
  );
});
