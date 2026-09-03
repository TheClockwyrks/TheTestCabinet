// simulation/support-node-load-crosses-the-corner — a load applied at a
// top-flange node changes no arm member and crosses the ring whole.
//
// `specs/statics.md` § The two solves states the reaction rule the whole of this
// rests on: "Each support's reaction is read back: the reaction at a support node
// is minus the sum of the applied force there and every member force pulling on
// it", and the tower solve applies "at each bottom-flange node, the negated
// reaction read at the top-flange node it shares a ring corner with".
//
// A counterweight on a TOP-FLANGE node is the cleanest probe of that rule there
// is. Top-flange nodes are the arm solve's supports, and a support's rows and
// columns leave the system, so an applied force there cannot reach any arm
// member: every arm force must be unchanged to the last bit. The whole of it
// instead shows up in that support's reaction, is negated, and is applied at the
// bottom-flange node the ring pairs it with — so exactly one tower member should
// move, and by exactly `COUNTERWEIGHT_MASS` (`80`) times `GRAVITY` (`10`).
//
// THE TOWER IS SHAPED SO THAT ONE MEMBER READS THE CROSSING EXACTLY. Two of the
// four bottom-flange corners carry a vertical leg and horizontal members and
// nothing else. Horizontal members contribute nothing to vertical equilibrium, so
// at such a corner the leg's force is exactly minus the whole vertical load
// applied at that node — the node's own lumped mass and the reaction carried down
// from its top-flange partner. Nothing else in the crane has to be reasoned about:
// the leg under the counterweighted corner must move by `800` and the leg under
// the OTHER leg-only corner must not move at all, because the reaction crosses at
// its own corner and is "negated and turned no further".

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertLength, assertTrue } from "../assert";
import { COUNTERWEIGHT_MASS, GRAVITY } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/**
 * A crane whose two `z = 2` bottom-flange corners carry a vertical leg and
 * horizontal members alone.
 *
 * The tower is the cube between site 1's four anchors and the ring's bottom
 * flange at `y = 2`: four vertical legs, the four sides of the flange square,
 * both of its horizontal diagonals, and four inclined anchor braces gathered at
 * the two `z = 0` corners. That leaves `(0, 2, 2)` and `(2, 2, 2)` with their leg
 * and horizontals only. The arm is the mast at `(0, 8, 0)`, tied to all four
 * top-flange nodes, and one rail out to `(4, 4, 0)` held by two flange ties and
 * the mast.
 */
const MEMBERS: CraneDesign["members"] = [
  // 0-3: the four legs, anchor to bottom flange.
  [[0, 0, 0], [0, 2, 0], "strut"],
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 2], "strut"],
  [[2, 0, 2], [2, 2, 2], "strut"],
  // 4-7: the flange square's four sides, horizontal.
  [[0, 2, 0], [2, 2, 0], "strut"],
  [[0, 2, 2], [2, 2, 2], "strut"],
  [[0, 2, 0], [0, 2, 2], "strut"],
  [[2, 2, 0], [2, 2, 2], "strut"],
  // 8-9: both horizontal diagonals across it.
  [[0, 2, 0], [2, 2, 2], "strut"],
  [[2, 2, 0], [0, 2, 2], "strut"],
  // 10-13: the inclined anchor braces, all four at the two z = 0 corners.
  [[2, 0, 0], [0, 2, 0], "strut"],
  [[0, 0, 2], [0, 2, 0], "strut"],
  [[0, 0, 0], [2, 2, 0], "strut"],
  [[2, 0, 2], [2, 2, 0], "strut"],
  // 14-17: the mast, tied to all four top-flange nodes.
  [[0, 4, 0], [0, 8, 0], "strut"],
  [[2, 4, 0], [0, 8, 0], "strut"],
  [[0, 4, 2], [0, 8, 0], "strut"],
  [[2, 4, 2], [0, 8, 0], "strut"],
  // 18-21: the track and the three ties that hold its far end up.
  [[0, 4, 0], [4, 4, 0], "rail"],
  [[0, 4, 2], [4, 4, 0], "strut"],
  [[2, 4, 2], [4, 4, 0], "strut"],
  [[0, 8, 0], [4, 4, 0], "strut"],
];

const CRANE: CraneDesign = {
  site: 1,
  name: "Leg-only corners",
  ring: [0, 2, 0],
  counterweights: [],
  members: MEMBERS,
  tape: [],
};

/** The same crane with a counterweight on the top-flange node `(2, 4, 2)`. */
const LOADED: CraneDesign = { ...CRANE, counterweights: [[2, 4, 2]] };

/** The leg under `(2, 2, 2)`, the corner `(2, 4, 2)` is paired with. */
const PAIRED_LEG = 3;

/** The leg under `(0, 2, 2)`, the other leg-only corner. */
const OTHER_LEG = 2;

/** The arm's members: the mast, the rail, and the ties. Ids 14 through 21. */
const ARM_MEMBERS = [14, 15, 16, 17, 18, 19, 20, 21];

/** `COUNTERWEIGHT_MASS * GRAVITY`: the whole weight that crosses the corner. */
const CROSSING = COUNTERWEIGHT_MASS * GRAVITY;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries a top-flange counterweight across its own ring corner alone", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, CRANE);

  const before = await h.check();
  assertLength(
    before.issues,
    1,
    "the bare crane's issues, the empty tape alone",
  );
  assertEqual(before.issues[0], "empty-program", "the only issue");
  assertTrue(before.stable, "the crane stands before the counterweight");

  await poseCrane(h, LOADED);
  const after = await h.check();
  assertTrue(after.stable, "the crane still stands with the counterweight");
  await h.capture(
    "support-node-load-crosses-the-corner",
    "the crane with a counterweight on the top-flange node (2, 4, 2)",
  );

  const forceOf = (result: typeof before, id: number): number => {
    const member = result.members.find((one) => one.id === id);
    if (member === undefined) {
      throw new Error(`gantry: check() reported no member ${id}`);
    }
    return member.force;
  };

  // The counterweight sits on an arm SUPPORT, so it reaches no arm member: the
  // supported system it would have loaded has no row for that node at all.
  for (const id of ARM_MEMBERS) {
    assertClose(
      forceOf(after, id),
      forceOf(before, id),
      1e-6,
      `arm member ${id}'s force across a counterweight placed on a top-flange ` +
        "node, which is a support of the arm solve (specs/statics.md)",
    );
  }

  // And it crosses the ring whole, at its own corner: COUNTERWEIGHT_MASS times
  // GRAVITY more compression in the leg under the bottom-flange node that corner
  // pairs it with, and nothing at all at the other leg-only corner.
  assertClose(
    forceOf(after, PAIRED_LEG) - forceOf(before, PAIRED_LEG),
    -CROSSING,
    1e-6,
    `the change in the leg under (2, 2, 2): the whole ${CROSSING} the ` +
      "counterweight on its ring partner (2, 4, 2) weighs, arriving as " +
      "compression (specs/statics.md)",
  );
  assertClose(
    forceOf(after, OTHER_LEG) - forceOf(before, OTHER_LEG),
    0,
    1e-6,
    "the change in the leg under (0, 2, 2): the reaction crosses at its own " +
      "corner and is turned no further, so this corner carries none of it",
  );
});
