// instrumentation/dive-launching-gate — with the assault's own choice of dives
// gated off, an assembled formation launches none; with it on, one launches.
//
// specs/instrumentation.md gives the gate exactly one faculty:
// `setDiveLaunching(enabled)` gates "The assault's own choice of which formation
// drone dives next, and when. Off, no dive is launched. A drone already diving
// flies its dive as usual." It adds, of the wave's own clock, that "The clock
// advances only while `diveLaunching` is on."
//
// WITHOUT IT, ANY SCENARIO WITH A FORMATION IN IT IS PULLED APART. specs/swarm.md
// launches a wave's first dive when the dive clock reaches `DIVE_FIRST_DELAY`
// (`2.0`) seconds and each later one after a gap drawn between `DIVE_GAP_MIN` and
// `DIVE_GAP_MAX`, taking a drone "chosen at random from those standing" — so a
// drone posed to be shot at, read for its band, or counted in a formation is
// liable to be taken into a dive two seconds in, and the check that posed it is
// then reading a diving drone. `startPosed` shuts this gate for exactly that
// reason, and this is where it is decided.
//
// WHAT IS READ IS A DRONE IN PHASE `diving`, which is what a launch does: it
// "takes one drone resting in the formation ... and puts it in phase `diving`"
// (specs/swarm.md). Every drone below is posed resting in a slot with all three
// faculties off, so nothing but a launch can change one of those phases, and a
// launched drone reports `diving` whether or not its travel is gated.
//
// THE DIVE CLOCK IS POSED PAST EVERY GAP THE SPECIFICATION NAMES, so the gated
// half is not a wait for a delay to run out. `DIVE_FIRST_DELAY` plus
// `DIVE_GAP_MAX` times `diveGapScale(1)` is `4.6` s, beyond the first dive's
// delay and beyond the longest gap any later dive draws, so a launcher the gate
// does not hold has its figure in hand on the very first frame; a build whose
// gate merely delays the assault, or one whose clock keeps running under it and
// launches a fresh gap later, is caught inside the three seconds the formation is
// then played for, which is longer than `DIVE_GAP_MAX` itself. What the clock
// does under the gate is not read here, and the clock is a wave figure the
// specification bounds below and not above, so a posed `4.6` s is inside what it
// allows.
//
// AND THE GATE IS THEN OPENED ON THE SAME FORMATION. Without that half, a build
// that never launches a dive at all would pass a point about holding its dives.
// The clock already stands past the figure the launcher waits on, so a conforming
// build launches at once; it is given three `DIVE_FIRST_DELAY`s all the same, so a
// build whose launcher is anywhere up to three times late still launches inside
// it and is graded on the figure by `swarm/dive-first-delay`.
//
// WHAT THIS DOES NOT DECIDE. When a dive is launched, how the gaps are drawn, or
// which drone is taken — `swarm/dive-first-delay`, `swarm/dive-cadence` and
// `swarm/dive-leaves-slot` — nor what the dive clock does while the gate is shut,
// which no point reads on its own.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  FORM_COLS,
  diveGapScale,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  poseFormation,
  startPosed,
  ticksFor,
  type FormationEntry,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The stage the formation is posed at, which `startPosed` opens the field at. */
const STAGE = 1;

/**
 * The rows of the grid the formation fills.
 *
 * Two full rows, which is a block of drones resting in their slots — the situation
 * specs/swarm.md launches a dive out of. How many drones a wave holds and which
 * slots it fills are the wave's own business (`swarm/wave-composition`), and
 * nothing here reads either.
 */
const ROWS = [0, 1] as const;

/**
 * Where the wave's dive clock is posed, in seconds: past the first dive's delay
 * and past the longest gap a later dive draws at this stage, so a launcher the
 * gate does not hold has nothing left to wait for.
 */
const POSED_CLOCK = DIVE_FIRST_DELAY + DIVE_GAP_MAX * diveGapScale(STAGE);

/**
 * How long the gated formation is played for, in seconds.
 *
 * Longer than `DIVE_GAP_MAX` (`2.6`), so a build whose clock runs on under the
 * gate and launches a whole fresh gap later is still seen doing it.
 */
const GATED_SECONDS = 3;

/**
 * How long the ungated formation is given to launch one, in seconds.
 *
 * Three `DIVE_FIRST_DELAY`s. The posed clock already stands past the figure the
 * launcher waits on, so a conforming build launches at once; a build whose first
 * dive is as much as three times late still launches inside it, and
 * `swarm/dive-first-delay` is what grades the figure.
 */
const UNGATED_SECONDS = 3 * DIVE_FIRST_DELAY;

/** How much game time separates two samples of the formation, in seconds. */
const POLL_SECONDS = 0.25;

/** Whether any drone has left its slot for a dive. */
function anyDiving(s: SpectraSnapshot): boolean {
  return s.drones.some((drone) => drone.phase === "diving");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("launches no dive while the gate is off, and one once it is on", async () => {
  startPosed(h);

  const entries: FormationEntry[] = [];
  for (const row of ROWS) {
    for (let col = 0; col < FORM_COLS; col += 1) {
      entries.push({ kind: "shard", col, row });
    }
  }
  const formation = poseFormation(h, entries);

  // The clock past every figure the launcher could be waiting on, so the gate is
  // the only thing between the formation and a dive.
  h.debug.setDiveClock(POSED_CLOCK);

  const launchedGated = await h.until(anyDiving, {
    maxFrames: ticksFor(GATED_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  // Before the assertions, so a failing gate still leaves the picture of the
  // formation it should have held together.
  captureStill(h, "holding");
  assertEqual(
    launchedGated.hit,
    false,
    `whether any of the ${String(formation.length)} drones resting in the ` +
      `formation entered phase "diving" over ${String(GATED_SECONDS)} s with ` +
      `setDiveLaunching(false) held and the dive clock posed at ` +
      `${String(POSED_CLOCK)} s — past DIVE_FIRST_DELAY (` +
      `${String(DIVE_FIRST_DELAY)} s) plus DIVE_GAP_MAX (` +
      `${String(DIVE_GAP_MAX)} s) (specs/swarm.md)`,
  );

  // And the control: the formation really was one a dive could be launched from.
  h.debug.setDiveLaunching(true);
  const launched = await h.until(anyDiving, {
    maxFrames: ticksFor(UNGATED_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  assertTrue(
    launched.hit,
    `a dive to be launched within ${String(UNGATED_SECONDS)} s of ` +
      "setDiveLaunching(true) on the same formation, with the dive clock posed " +
      `at ${String(POSED_CLOCK)} s — without one, a formation that held ` +
      "together while the gate was off says nothing about the gate",
  );
});
