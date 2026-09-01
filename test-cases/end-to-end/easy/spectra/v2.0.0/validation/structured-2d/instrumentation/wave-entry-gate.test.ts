// instrumentation/wave-entry-gate — with the wave's own release of drones gated
// off, a stage that opens brings no drone into the play field; with it on, drones
// arrive.
//
// specs/instrumentation.md gives the gate exactly one faculty:
// `setWaveEntry(enabled)` gates "The wave's own release of drones: the staggered
// groups a stage sends in on the `ENTER_GROUP_GAP` schedule. Off, no drone arrives
// unless one is added. A drone already traveling its entrance flies it as usual."
//
// WITHOUT IT, MOST OF THIS SUITE IS INVADED. specs/swarm.md releases a wave's
// first group as the wave opens and each later group `ENTER_GROUP_GAP` (`0.6` s)
// after the one before it, and a released drone crosses `FIELD_TOP` within a
// second of its release — so any scenario running longer than half a second on a
// live wave is joined by drones it never asked for. `startPosed` shuts this gate
// for exactly that reason, and this is where it is decided.
//
// WHAT IS READ IS THE PLAY FIELD, NOT THE ROSTER. specs/swarm.md puts every drone
// of the wave on the roster the moment the wave is built, "each in phase
// `entering`, at its own starting point above `FIELD_TOP`, so no drone stands
// inside the play field when the wave opens" — so a full roster is what a
// conforming build reports whether the gate is open or shut, and the arrival the
// gate governs is a drone crossing `FIELD_TOP` into the field (specs/field.md). A
// drone standing exactly on the boundary is not counted as arrived, which leaves
// the boundary itself to the build.
//
// TEN SECONDS IS LONGER THAN ANY SCHEDULE THE SPECIFICATION NAMES. A wave releases
// its drones "in between two and eight groups", so eight groups at
// `ENTER_GROUP_GAP` is `4.2` s from the wave opening to the last release, and a
// release is inside the field within one more — under `5.5` s in all. Ten is
// nearly twice that, so a build whose gate merely delays the schedule is caught.
//
// AND THE GATE IS THEN OPENED ON THE SAME WAVE. Without that half, a build whose
// stage never built a wave at all would pass a point about keeping one out. Two
// seconds is double the second specs/swarm.md gives a released drone to cross into
// the field, and the first group is released as the wave's entry clock stands at
// zero — which is where the gate held it.
//
// THE OTHER TWO WORLD GATES ARE SHUT THROUGHOUT, which is the isolation this point
// needs: the requirement here is the entry alone, and neither a dive launch nor
// the ship's contact test has any part in whether a drone crossed into the field.
//
// WHAT THIS DOES NOT DECIDE. The schedule itself — that the groups arrive
// `ENTER_GROUP_GAP` apart, at `ENTER_SPEED`, along a continuous path — which are
// `swarm.entry-group-gap`, `swarm.entrance-speed` and `swarm.entrance-continuous`,
// nor that the field is empty for the intro, which is `swarm.wave-empty-at-start`.

import { afterEach, beforeEach, it } from "vitest";
import { ENTER_GROUP_GAP, FIELD_TOP } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startStage,
  ticksFor,
  type Harness,
  type SpectraSnapshot,
} from "../harness";

/** The stage whose wave is opened: a standard one, so a formation is what enters. */
const STAGE = 1;

/** How long the gated wave is played for, in seconds. */
const GATED_SECONDS = 10;

/**
 * How long the ungated wave is given to put a drone in the field, in seconds.
 *
 * Two. The first group is released as the wave's entry clock reads zero — which
 * is where the closed gate left it — and specs/swarm.md carries a released drone
 * across `FIELD_TOP` "within one second of its release", so this is double the
 * figure.
 */
const UNGATED_SECONDS = 2;

/** How much game time separates two samples of the field, in seconds. */
const POLL_SECONDS = 0.25;

/** Whether any drone stands inside the play field, past `FIELD_TOP`. */
function anyDroneInField(s: SpectraSnapshot): boolean {
  return s.drones.some((drone) => drone.y > FIELD_TOP);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps the wave's own drones out of the field while the gate is off", async () => {
  // The gate is shut before the wave is built, so not even its first group is
  // released. The other two world gates are shut for isolation alone.
  h.debug.setWaveEntry(false);
  h.debug.setDiveLaunching(false);
  h.debug.setShipContact(false);

  // The build's own transition out of the stage intro is what lays the wave out.
  await startStage(h, STAGE);

  const arrivedGated = await h.until(anyDroneInField, {
    maxFrames: ticksFor(GATED_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  // Before the assertions, so a failing gate still leaves the picture of the
  // field it should have kept empty.
  captureStill(h, "empty");
  assertEqual(
    arrivedGated.hit,
    false,
    `whether any drone stood inside the play field (past FIELD_TOP, ` +
      `${FIELD_TOP}) over ${GATED_SECONDS} s of a stage-${STAGE} wave with ` +
      `setWaveEntry(false) held — eight groups at ENTER_GROUP_GAP ` +
      `(${ENTER_GROUP_GAP} s) plus the second a release is given to cross in ` +
      `is under 5.5 s (specs/swarm.md), so that span is nearly twice the ` +
      `longest schedule the specification allows`,
  );

  // And the control: the wave really did have drones to send in.
  h.debug.setWaveEntry(true);
  const arrived = await h.until(anyDroneInField, {
    maxFrames: ticksFor(UNGATED_SECONDS),
    poll: ticksFor(POLL_SECONDS),
  });
  assertTrue(
    arrived.hit,
    `a drone to stand inside the play field within ${UNGATED_SECONDS} s of ` +
      `setWaveEntry(true) on the same wave — without one, an empty field ` +
      `while the gate was off says nothing about the gate`,
  );
});
