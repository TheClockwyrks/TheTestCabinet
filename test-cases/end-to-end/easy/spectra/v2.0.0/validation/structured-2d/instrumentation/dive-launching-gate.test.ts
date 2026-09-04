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
// "takes one drone resting in the formation… and puts it in phase `diving`"
// (specs/swarm.md). Every drone below is posed resting in a slot with all three
// faculties off, so nothing but a launch can change one of those phases, and a
// launched drone reports `diving` whether or not its travel is gated.
//
// TWENTY SECONDS IS SEVERAL TIMES ANY GAP THE SPECIFICATION NAMES.
// `DIVE_FIRST_DELAY` is `2.0` s and the longest later gap is `DIVE_GAP_MAX`
// (`2.6`) times `diveGapScale(1)` (`1`), so twenty seconds is ten first delays: a
// build whose gate merely delays the assault rather than holding it is caught.
//
// THE DIVE CLOCK IS POSED TO ZERO BEFORE EITHER HALF, so the delay the ungated
// half measures runs from a moment this check chose rather than from whenever the
// build decided its formation had assembled.
//
// AND THE GATE IS THEN OPENED ON THE SAME FORMATION. Without that half, a build
// that never launches a dive at all would pass a point about holding its dives.
// Six seconds is three `DIVE_FIRST_DELAY`s, so a build whose delay is anywhere up
// to three times the figure still launches inside it and is graded on the figure
// by `swarm.dive-first-delay`.
//
// WHAT THIS DOES NOT DECIDE. When a dive is launched, how the gaps are drawn, or
// which drone is taken — `swarm.dive-first-delay`, `swarm.dive-cadence` and
// `swarm.dive-leaves-slot` — nor what the dive clock does while the gate is shut,
// which no point reads on its own.

import { afterEach, beforeEach, it } from "vitest";
import { DIVE_FIRST_DELAY, DIVE_GAP_MAX, FORM_COLS } from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  dronesInPhase,
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
 * Two full rows, which is a block of drones resting in their slots — the
 * situation specs/swarm.md launches a dive out of. How many drones a wave holds
 * and which slots it fills are the wave's own business
 * (`swarm.wave-composition`), and nothing here reads either.
 */
const ROWS = [0, 1] as const;

/** How long the gated formation is played for, in seconds. */
const GATED_SECONDS = 20;

/**
 * How long the ungated formation is given to launch one, in seconds.
 *
 * Three `DIVE_FIRST_DELAY`s. A build whose first dive is as much as three times
 * late still launches inside it, and `swarm.dive-first-delay` is what grades the
 * figure.
 */
const UNGATED_SECONDS = 3 * DIVE_FIRST_DELAY;

/** How much game time separates two samples of the formation, in seconds. */
const POLL_SECONDS = 0.25;

/** Whether any drone has left its slot for a dive. */
function anyDiving(s: SpectraSnapshot): boolean {
  return dronesInPhase(s, "diving").length > 0;
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

  // The clock at a moment this check chose, so the ungated half below measures
  // from there rather than from an assembly the build decided on.
  h.debug.setDiveClock(0);

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
    `whether any of the ${formation.length} drones resting in the formation ` +
      `entered phase "diving" over ${GATED_SECONDS} s at stage ${STAGE} with ` +
      `setDiveLaunching(false) held — that is ten DIVE_FIRST_DELAYs ` +
      `(${DIVE_FIRST_DELAY} s) and several times DIVE_GAP_MAX ` +
      `(${DIVE_GAP_MAX} s) (specs/swarm.md)`,
  );

  // And the control: the formation really was one a dive could be launched from.
  h.debug.setDiveLaunching(true);
  const launched = await h.until(anyDiving, {
    maxFrames: ticksFor(UNGATED_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  assertTrue(
    launched.hit,
    `a dive to be launched within ${UNGATED_SECONDS} s of ` +
      `setDiveLaunching(true) on the same formation, with the dive clock ` +
      `posed at 0 — without one, a formation that held together while the ` +
      `gate was off says nothing about the gate`,
  );
});
