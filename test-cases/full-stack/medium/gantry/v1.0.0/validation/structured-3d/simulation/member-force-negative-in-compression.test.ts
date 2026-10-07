// simulation/member-force-negative-in-compression — the same figure is negative
// when the member is in compression.
//
// specs/statics.md, The two solves: the axial force is "positive in tension,
// negative in compression".
//
// The member read is the vertical leg under the minimal crane's bottom-flange
// corner `(0, 2, 0)`, which is its member `0`. That corner is reached by that leg
// and by horizontal members alone — the flange square's two sides and the
// diagonal across it — so the node's vertical equilibrium bears on the leg and on
// nothing else: with the leg running straight down to its anchor, its force is
// exactly the vertical force applied at the node. Hanging weight there therefore
// drives the number the leg reports DOWN by exactly what was hung, and a leg
// pressed down on to its anchor reports a figure below zero.
//
// The weight is one counterweight, `COUNTERWEIGHT_MASS` (80) at that node, which
// `specs/statics.md` lumps there and applies as `m * g`. Reading the leg with and
// without it is what makes this a measurement of the sign rather than of the rig:
// the difference between the two readings is a figure the specification states,
// and a build that reported compression as positive would show the leg's force
// RISE by that same 800 as weight was hung on it.
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE, AND THE COUNTERWEIGHT IS ONE EDIT ON
// TOP OF IT. Nothing in this point is about the crane's shape beyond that one
// corner, so the crane is the shared twenty-one-member one every check uses when
// its requirement is not about the crane, and the second reading is taken on the
// very structure the first was taken on with a single counterweight added. A
// crane posed twice would hand the comparison two sets of member ids to be right
// about, for no gain.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLessThan, assertTrue, fail } from "../assert";
import { COUNTERWEIGHT_MASS, GRAVITY } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  standMinimalCrane,
  type Harness,
  type MemberForce,
} from "../harness";

/** The leg under the bottom-flange corner no diagonal reaches: member `0`. */
const LEG = 0;

/** That corner: reached by its leg and by horizontals alone. */
const CORNER = [0, 2, 0] as const;

/** The force the reported member list carries for `id`. */
function forceOf(members: readonly MemberForce[], id: number): number {
  const found = members.find((one) => one.id === id);
  if (found === undefined) {
    fail(`member ${id} to be reported (specs/state.md)`, "it is missing");
  }
  return found.force;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports a negative force in a tower leg pressed down on its anchor", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);

  const bare = await h.check();
  assertTrue(
    bare.stable,
    "the crane to stand, so the check reports every member " +
      "(specs/structure.md)",
  );

  await h.debug.addCounterweight(CORNER[0], CORNER[1], CORNER[2]);
  const loaded = await h.check();
  await h.capture(
    "leg-in-compression",
    "the crane with a counterweight on the bottom-flange corner (0, 2, 0)",
  );

  assertTrue(
    loaded.stable,
    "the crane to stand with the counterweight on the corner " +
      "(specs/structure.md)",
  );

  const force = forceOf(loaded.members, LEG);
  assertLessThan(
    force,
    0,
    `the force in the leg under (${CORNER[0]}, ${CORNER[1]}, ${CORNER[2]}) ` +
      "carrying the counterweight down to its anchor (specs/statics.md)",
  );
  assertClose(
    force - forceOf(bare.members, LEG),
    -(COUNTERWEIGHT_MASS * GRAVITY),
    1e-6,
    "how that leg's force moves when COUNTERWEIGHT_MASS is hung at the one " +
      "node it holds up (specs/statics.md)",
  );
});
