// swarm/dive-first-delay — the wave's first dive waits DIVE_FIRST_DELAY.
//
// specs/swarm.md, "The dive": "The wave carries one dive clock, in seconds. It
// advances with game time while the wave's dive launching runs, and it returns to
// `0` each time a dive is launched." The first launch happens when that clock
// reaches `DIVE_FIRST_DELAY` (`2.0`) seconds.
//
// WHY THE CLOCK IS POSED AS WELL AS THE FORMATION. A posed formation has no "moment
// the wave assembled" for a hidden timer to have started from, so a build that
// measures its first delay from the assembly transition would launch nothing here
// while a build running a free clock launched on time — and both honour the
// specification. `specs/instrumentation.md` therefore makes the wave's dive clock
// declared, settable state, and this validator poses it at `0` and opens the dive
// gate in the same breath, so the moment the delay runs from is one the validator
// chose rather than one it guessed.
//
// THE FORMATION IS COMPLETE AND EVERY DRONE OF IT IS INERT. A launch "takes one
// drone resting in the formation, chosen at random from those standing", so the
// grid is filled to leave the choice nothing to be short of; and each drone is
// posed with all three faculties off, because this point is about WHEN the wave
// launches, not about what the drone then does. Nothing in the scenario moves but
// the clock under test.
//
// The delay alone is asserted here. That the launched drone leaves its slot is
// `swarm/dive-leaves-slot`, and what the later gaps are is `swarm/dive-cadence`.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRST_DELAY, FORM_COLS, FORM_ROWS } from "../constants";
import { assertLessThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseFormation,
  seconds,
  startPosed,
  ticksFor,
  type FormationEntry,
  type Harness,
} from "../harness";

/** The stage the formation is posed at: the first, which `startPosed` opens. */
const STAGE = 1;

/** How far the first launch may sit from the delay: the item's own 20%. */
const DELAY_TOLERANCE = DIVE_FIRST_DELAY * 0.2;

/**
 * How long the sweep waits for that first launch, in frames.
 *
 * Twice the delay, so a build that launches late enough to fail the tolerance above
 * is still SEEN launching and the failure reads as the delay it really ran rather
 * than as a wave that never dived.
 */
const SWEEP_FRAMES = ticksFor(2 * DIVE_FIRST_DELAY);

/**
 * Every slot of the grid specs/field.md fixes, filled with an inert Shard.
 *
 * The whole grid rather than a handful, so a build that launches from a chosen
 * subset of the block still has something to launch, and so nothing about which
 * slots are filled can delay the launch this point times.
 */
const FULL_FORMATION: FormationEntry[] = Array.from(
  { length: FORM_ROWS * FORM_COLS },
  (_, index) => ({
    kind: "shard" as const,
    col: index % FORM_COLS,
    row: Math.floor(index / FORM_COLS),
  }),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches the wave's first dive DIVE_FIRST_DELAY after the dive clock starts", async () => {
  startPosed(h);
  poseFormation(h, FULL_FORMATION);
  h.debug.setDiveClock(0);
  h.debug.setDiveLaunching(true);

  const launched = await h.until(
    (snapshot) => snapshot.drones.some((drone) => drone.phase === "diving"),
    { maxFrames: SWEEP_FRAMES, poll: 1 },
  );
  captureStill(h, "first");

  assertTrue(
    launched.hit,
    `a dive launched out of the complete formation within ` +
      `${String(seconds(SWEEP_FRAMES))}s of the dive clock being posed at 0 ` +
      `and dive launching turned on, at stage ${String(STAGE)} ` +
      `(specs/swarm.md)`,
  );
  assertLessThanOrEqual(
    Math.abs(seconds(launched.frames) - DIVE_FIRST_DELAY),
    DELAY_TOLERANCE,
    `how far the first dive's launch ` +
      `(${seconds(launched.frames).toFixed(2)}s after the dive clock was ` +
      `posed at 0) sat from DIVE_FIRST_DELAY ` +
      `(${String(DIVE_FIRST_DELAY)}) (specs/swarm.md)`,
  );
});
