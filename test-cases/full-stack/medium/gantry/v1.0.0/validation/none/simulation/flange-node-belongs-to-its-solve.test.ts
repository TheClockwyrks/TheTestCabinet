// simulation/flange-node-belongs-to-its-solve — a bottom-flange node no member
// reaches is still a node of the tower solve, with nothing holding it.
//
// specs/statics.md, The two solves: "A flange node belongs to its solve whether
// or not a member ends there, since it carries ring mass and, on the bottom
// flange, the force carried across." A node in the solve with no member ending at
// it has no stiffness at all, so the supported system has unknowns and nothing to
// resist them — which `specs/statics.md`, Singularity, settles outright: "A
// supported system that has unknowns and no stiffness anywhere has a largest
// diagonal of `0` and a first pivot of `0`, so it is singular."
//
// The scenario removes every member ending at one bottom-flange corner and leaves
// the other three carried exactly as they were. Nothing about readiness changes:
// the crane still has its ring, its rails still form a track, and every member
// left has a path to an anchor or a flange node, so `check.issues` stays empty
// (`specs/structure.md`) — which is the point. Readiness is the editor's verdict
// and standing is the solve's, and here the two part company.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE. What this decides is a property of the
// TOWER SOLVE'S NODE SET, which every crane's bottom flange has, so the scenario
// is the smallest crane that stands rather than one shaped for reading forces
// off: twenty-one members posed instead of twenty-nine, and nothing in the yard
// or the arm that this requirement does not concern.
//
// The tape is posed so that `empty-program` is not among the issues either, and
// the crane is read before the removal as well, so a build that never stands
// anything cannot pass by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
} from "../harness";

/**
 * The members ending at the minimal crane's bottom-flange corner `(0, 2, 0)`,
 * by the ids `poseCrane` gives them: its leg up from the anchor beneath it, the
 * two flange horizontals that run from it, and the diagonal across the flange
 * square. Nothing else in that crane reaches the node, and the ring's own base
 * corner stands there, so what is left is a flange node of the tower solve with
 * no member at all.
 */
const AT_CORNER = [0, 4, 6, 8];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not stand when a bottom-flange node has no member reaching it", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);

  const whole = await h.check();
  assertLength(
    whole.issues,
    0,
    "the issues of the whole crane, which is ready and has a tape " +
      "(specs/structure.md)",
  );
  assertTrue(whole.stable, "the whole crane to stand (specs/statics.md)");

  for (const id of AT_CORNER) await h.debug.removeMember(id);
  const unreached = await h.check();
  await h.capture(
    "corner-unreached",
    "the crane with nothing reaching the bottom-flange corner (0, 2, 0)",
  );

  assertLength(
    unreached.issues,
    0,
    "the issues with the corner unreached: every member left still runs to an " +
      "anchor or a flange node, so readiness is satisfied " +
      "(specs/structure.md)",
  );
  assertTrue(
    !unreached.stable,
    "the crane to stand, when a bottom-flange node of the tower solve has no " +
      "stiffness at all (specs/statics.md)",
  );
  assertLength(
    unreached.members,
    0,
    "the members reported by a structure that does not stand " +
      "(specs/structure.md)",
  );
});
