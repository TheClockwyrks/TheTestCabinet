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
// IT IS MEASURED ON THE BUILD'S OWN CLOCK, for the reason the floor item states
// at length: `advance` bottoms out in an operation of an instrumentation surface a
// build may gate separately from its own frame loop, so a check driven through it
// measures where the pause gate sits rather than whether the floor moved. Nothing
// inside the scope calls `advance` or anything built on it, and both presses are
// real keys delivered through Chromium.
//
// THREE WINDOWS OF THE SAME LENGTH. The first is running and the second paused,
// and neither is asserted here — they are `waves/pause-freezes-the-floor`'s
// readings. What they are for is the PRECONDITION: the game must actually have
// been paused when the second press arrived, or "resuming" is not what this check
// did. That precondition is the screen the pause left behind, and nothing else
// about those two windows is graded, so a build that fails the freeze can still
// pass the thaw and be told apart.
//
// THE TRAVEL IS READ FROM THE SNAPSHOT TAKEN AT THE END OF THE PAUSED WINDOW to
// the one taken at the end of the resumed one, so the leg measured begins where
// the freeze ended.
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
import { BINDINGS, SURGE_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  requireUnit,
  startRun,
  type Harness,
} from "../harness";
import { poseRunningFloor } from "./run";

/**
 * The real time each of the three legs is measured over: a second and a half.
 *
 * Geometry rather than a tolerance. A Mote's specified `60` logical units per
 * second (`specs/surge.md`) carries it `90` units, four and a half tiles, in that
 * time — far more than the bound below.
 */
const PAUSE_WINDOW_MS = 1500;

/**
 * How far the Mote must travel in the resumed leg: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in the window: a build that lost
 * two thirds of that window to a clamped frame delta, to the handover or to a
 * frame rate a third of the usual would still clear it. It is the same figure the
 * running leg of `waves/pause-freezes-the-floor` is held to, because it is the
 * same claim — that the floor is advancing — read after a resume rather than
 * before a pause.
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

  const legs = await h.withOwnClock(async (clock) => {
    await clock.settle(PAUSE_WINDOW_MS);
    await clock.press(BINDINGS.pause);
    await clock.settle(PAUSE_WINDOW_MS);
    // The snapshot the resumed leg is measured from: the end of the paused
    // window, which is where the freeze the resume lifts left the floor.
    const held = await clock.read();
    await clock.press(BINDINGS.pause);
    await clock.settle(PAUSE_WINDOW_MS);
    return { held, resumed: await clock.read() };
  });

  await captureStill(h, "resumed");

  assertEqual(
    legs.held.screen,
    "paused",
    "precondition: the first press paused the game, so the second one resumes it",
  );
  assertEqual(
    legs.resumed.screen,
    "playing",
    "the screen the second press returned to (specs/screens.md: RESUME goes to `playing`, with the floor exactly as it was left)",
  );
  assertGreaterThan(
    distance(
      requireUnit(
        legs.held,
        mote,
        "the resumed window on the build's own clock",
      ),
      requireUnit(
        legs.resumed,
        mote,
        "the resumed window on the build's own clock",
      ),
    ),
    PAUSE_MIN_TRAVEL,
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled across the window after the resume, on the build's own clock`,
  );
});
