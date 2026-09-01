// instrumentation/remove-drone — `removeDrone(id)` takes the drone carrying that
// id off the field and leaves every other drone exactly as it was.
//
// specs/instrumentation.md gives the operation one line — "Removes the drone with
// that id" — and the rule that makes it addressable at all is beside it, under
// Identity: an id is "distinct among the entities live at any moment", and "an
// entity keeps its id for its whole life". A removal that took the wrong drone, or
// that took more than one, would mis-pose every scenario that trims a field down
// to the drones its requirement concerns.
//
// THE DRONE TAKEN IS THE MIDDLE ONE OF THREE, which is the distinguishing choice:
// a build that removes the first entry of the roster, or the last, or the whole
// roster, each leaves a different pair standing, so a failure names which wrong
// model the build implemented rather than saying only that a drone was wrong.
//
// AND THE SURVIVORS ARE COMPARED ENTRY BY ENTRY, not counted. The specification
// leaves an entity's id untouched for its whole life, so a build that re-numbered
// the roster after the splice — which is what a build storing "the id" as a roster
// POSITION does — is caught here, and every per-entity operation in the rest of
// this suite depends on it not doing that.
//
// NOTHING RUNS BETWEEN THE POSE AND THE READING. The harness owns the clock, so
// the two readings are of the same instant and the survivors are held to being
// UNTOUCHED rather than to being merely still there; every drone is posed with all
// three faculties off for the same reason.
//
// WHAT THIS DOES NOT DECIDE. What removing a drone does to the rest of the field —
// `instrumentation/clear-drones` reads the bullets and the bursts through the
// wholesale clear — nor whether a removal clears the stage: specs/stages.md clears
// one in the moment the last drone of its wave is DESTROYED, and this operation
// destroys nothing, which `stages/empty-wave-does-not-clear` grades.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNull, fail } from "../assert";
import {
  captureStill,
  createHarness,
  findDrone,
  type Harness,
} from "../harness";
import { poseCrowdedField, sortedById } from "./crowded";

/** Which of the standing drones is removed: the middle one of the three. */
const TAKEN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the drone with that id and leaves the others standing unchanged", async () => {
  const posed = await poseCrowdedField(h);
  const taken = posed.drones[TAKEN];
  if (taken === undefined) {
    fail(
      `a field posing at least ${String(TAKEN + 1)} drones for this scenario`,
      `${String(posed.drones.length)} drones`,
    );
  }

  const before = h.snapshot();
  assertLength(
    before.drones,
    posed.drones.length,
    "the drones standing before the removal, one per drone this scenario posed",
  );

  h.debug.removeDrone(taken);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a failing removal still leaves the picture of the
  // field it produced.
  captureStill(h, "removed");

  assertNull(
    findDrone(after, taken),
    `the drone carrying id ${String(taken)} after removeDrone(${String(taken)})`,
  );
  assertDeepEqual(
    sortedById(after.drones),
    sortedById(before.drones.filter((drone) => drone.id !== taken)),
    "every other drone on the field, against the same entries read at the " +
      `instant before removeDrone(${String(taken)}) was called — an entity ` +
      "keeps its id for its whole life (specs/instrumentation.md, Identity)",
  );
});
