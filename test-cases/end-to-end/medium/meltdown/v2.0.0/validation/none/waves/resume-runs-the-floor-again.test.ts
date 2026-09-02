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
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
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
 * The real time the two legs BEFORE the resume are held for: a second and a half
 * each.
 *
 * Nothing is read off either of them — the first only gets the floor moving and
 * the second only holds the game paused long enough for the resume to be a resume
 * — so their length is a stretch of wall clock and can be. What a busy host does
 * to them is give the game fewer frames in each, which changes nothing this item
 * asserts.
 */
const HOLD_WINDOW_MS = 1500;

/**
 * The game time the RESUMED leg covers, on the build's own clock: a second and a
 * half.
 *
 * The one leg this item reads, and it is a length on the BUILD'S clock rather than
 * on the host's. Nothing steps the game across it — the item is about the floor
 * running again with nobody turning the handle — but a leg that spends a fixed
 * stretch of wall clock and then asks how far the Mote got is asking how many
 * frames a loaded machine handed the page as much as it is asking about the
 * build, and a correct build loses the point for the load on the runner. Closed on
 * `simTime`, the leg covers the same stretch of the game however long the host
 * takes to deliver it. A Mote's specified `60` logical units per second
 * (`specs/surge.md`) carries it `90` units, four and a half tiles, across that
 * much game time — far more than the bound below.
 */
const RESUMED_LEG_SECONDS = 1.5;

/**
 * The real time the resumed leg is given to gain {@link RESUMED_LEG_SECONDS}: a
 * minute.
 *
 * A ceiling on the HOST, not a bound on the build. Failing to close the leg is
 * this item's own verdict here rather than a precondition, because a floor that
 * does not advance after the resume is exactly what the item is looking for.
 */
const RESUMED_LEG_DEADLINE_MS = 60_000;

/**
 * How far the Mote must travel in the resumed leg: `20` logical units.
 *
 * Derived from the `90` a specified Mote covers in {@link RESUMED_LEG_SECONDS} of
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

  const legs = await h.withOwnClock(async (clock) => {
    await clock.settle(HOLD_WINDOW_MS);
    await clock.press(BINDINGS.pause);
    await clock.settle(HOLD_WINDOW_MS);
    // The snapshot the resumed leg is measured from: the end of the paused
    // window, which is where the freeze the resume lifts left the floor.
    const held = await clock.read();
    await clock.press(BINDINGS.pause);
    const ran = await clock.gain(
      RESUMED_LEG_SECONDS,
      RESUMED_LEG_DEADLINE_MS,
    );
    return { held, ran, resumed: await clock.read() };
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
  assertTrue(
    legs.ran.reached,
    `the seconds the build's own clock gained after the resume, with nothing ` +
      `stepping it, within ${RESUMED_LEG_DEADLINE_MS / 1000}s of real time ` +
      `(specs/waves.md: resuming continues from exactly where the pause left it) ` +
      `— it gained ${(legs.resumed.simTime - legs.held.simTime).toFixed(3)} of ` +
      `the ${RESUMED_LEG_SECONDS} asked for`,
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
    `the units a Mote at its specified ${SURGE_DEFS.mote.speed} a second travelled across the ${RESUMED_LEG_SECONDS} seconds the build's own clock gained after the resume`,
  );
});
