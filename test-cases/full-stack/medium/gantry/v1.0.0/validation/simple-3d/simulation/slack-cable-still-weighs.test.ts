// simulation/slack-cable-still-weighs — going slack takes away a cable's
// stiffness and nothing else.
//
// `specs/statics.md` § Slack cables: "Going slack takes away a cable's stiffness
// and nothing else. A slack cable still hangs there and still weighs: the lumped
// masses and the applied forces are those of the whole intact structure, fixed
// before the iteration begins and unchanged by it."
//
// The weight of one cable is a small figure, so the scenario is built so that it
// lands somewhere it can be read EXACTLY rather than inferred from a difference
// of large numbers. The slack cable is the `(0, 2, 0)`-`(0, 2, 2)` side of the
// ring's bottom flange, and the tower is braced so that BOTH of its end nodes are
// corners carrying a vertical leg and horizontal members and nothing else. At such
// a corner the leg's force is exactly minus the whole vertical load applied at
// that node, since no other member there has a vertical component — and a slack
// cable, carrying zero force, has none either while still contributing "half of
// every intact member ending at it" to the node's lumped mass.
//
// So `removeMember` on the slack cable must lighten those two legs by exactly its
// whole weight between them: its length times `CABLE_MASS_PER_UNIT` (`0.15`) times
// `GRAVITY` (`10`). A build that dropped a slack cable's mass along with its
// stiffness reads `0` here instead.
//
// The sign is read off the build too, from the same crane with a strut put back on
// that side: that is what says the cable is one the solve would have pushed. It is
// read LAST, on the member the replacement takes rather than on a second whole
// crane — the geometry either reading solves is the same geometry, and a crane is
// twenty-three poses.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertEqual,
  assertLessThan,
  assertTrue,
} from "../assert";
import { CABLE_MASS_PER_UNIT, GRAVITY, LATTICE_PITCH } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
  type MaterialName,
} from "../harness";

/** The flange side this check is about: `(0, 2, 0)` to `(0, 2, 2)`, id `6`. */
const SIDE = 6;

/** The legs under that side's two ends, ids `0` and `2`. */
const LEG_UNDER_A = 0;
const LEG_UNDER_B = 2;

/**
 * The cable's whole weight: its length — one lattice pitch — times its
 * material's mass per unit times gravity.
 */
const CABLE_WEIGHT = LATTICE_PITCH * CABLE_MASS_PER_UNIT * GRAVITY;

/**
 * The id the strut that replaces the cable takes.
 *
 * `specs/instrumentation.md`: "`addMember` gives the member the structure's
 * `nextMemberId` and advances it by one", and a removal does not give the counter
 * back, so the twenty-third member placed on this crane is id `22` whether or not
 * id `6` is still standing.
 */
const SIDE_AS_STRUT = 22;

function craneWith(material: MaterialName): CraneDesign {
  const members: CraneDesign["members"] = [
    // 0-3: the four legs.
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    // 4-7: the flange square's four sides. Id 6 is the one under test.
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], material],
    [[2, 2, 0], [2, 2, 2], "strut"],
    // 8-9: both horizontal diagonals, which keep the square rigid in its plane
    // whether or not id 6 is carrying anything.
    [[0, 2, 0], [2, 2, 2], "strut"],
    [[2, 2, 0], [0, 2, 2], "strut"],
    // 10-13: the inclined anchor braces, all four gathered at the x = 2 corners,
    // so (0, 2, 0) and (0, 2, 2) carry a leg and horizontals alone.
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[2, 0, 2], [2, 2, 0], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    // 14-17: the mast, tied to all four top-flange nodes.
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[2, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[2, 4, 2], [0, 8, 0], "strut"],
    // 18-21: the track and the ties that hold its far end up.
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[0, 4, 2], [4, 4, 0], "strut"],
    [[2, 4, 2], [4, 4, 0], "strut"],
    [[0, 8, 0], [4, 4, 0], "strut"],
  ];
  return {
    site: 1,
    name: `Flange side as a ${material}`,
    ring: [0, 2, 0],
    counterweights: [],
    members,
    tape: [],
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a slack cable's weight on the structure that carries it", async () => {
  await openSite(h, 0);
  await clearAll(h);

  // The crane with a cable on that flange side. It goes slack and carries nothing.
  await poseCrane(h, craneWith("cable"));
  const withCable = await h.check();
  await h.capture(
    "slack-cable-still-weighs",
    "the crane whose flange side is a slack cable",
  );

  assertTrue(withCable.stable, "the crane stands with a cable on that side");
  assertEqual(
    withCable.members.find((one) => one.id === SIDE)?.force,
    0,
    `cable ${SIDE} goes slack and carries zero force (specs/statics.md)`,
  );

  // Take the slack cable away. Its stiffness was already out of the system, so
  // the only thing that leaves with it is its weight — and the two legs under its
  // ends carry exactly that much less between them.
  await h.debug.removeMember(SIDE);
  const without = await h.check();
  assertTrue(without.stable, "the crane still stands without that member");
  assertEqual(
    without.members.find((one) => one.id === SIDE),
    undefined,
    `member ${SIDE} once it is removed`,
  );

  const legOf = (result: typeof withCable, id: number): number => {
    const member = result.members.find((one) => one.id === id);
    if (member === undefined) {
      throw new Error(`gantry: check() reported no member ${id}`);
    }
    return member.force;
  };
  const lightened =
    legOf(without, LEG_UNDER_A) -
    legOf(withCable, LEG_UNDER_A) +
    (legOf(without, LEG_UNDER_B) - legOf(withCable, LEG_UNDER_B));
  assertClose(
    lightened,
    CABLE_WEIGHT,
    1e-6,
    "the compression the two legs under the slack cable's ends shed when it " +
      `is removed: its whole weight, ${CABLE_WEIGHT}, which it was still ` +
      "carrying to the ground while slack (specs/statics.md)",
  );

  // The sign, read off the build: put the same side back as a strut and the solve
  // pushes on it, so the cable that stood there was one the iteration drops.
  await h.debug.addMember(0, 2, 0, 0, 2, 2, "strut");
  const asStrut = await h.check();
  assertTrue(asStrut.stable, "the crane stands with a strut on that side");
  assertLessThan(
    asStrut.members.find((one) => one.id === SIDE_AS_STRUT)?.force ?? 0,
    0,
    `member ${SIDE_AS_STRUT}, the (0, 2, 0)-(0, 2, 2) flange side placed as a ` +
      "strut, carries compression",
  );
});
