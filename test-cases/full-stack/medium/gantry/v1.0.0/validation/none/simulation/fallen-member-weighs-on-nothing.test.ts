// simulation/fallen-member-weighs-on-nothing — a member joined to neither solve
// carries no weight either.
//
// specs/statics.md, The two solves: such a member "carries no force and no
// weight", so its mass leaves both solves along with it. A member's mass reaches
// the structure only as the half lumped at each of its nodes (`specs/statics.md`,
// The load model), and neither of a fallen member's nodes is a node of either
// solve — so the crane it fell off reads exactly as it does with the assembly
// never built.
//
// Two runs of the same crane, the same site, the same yard and the same tape,
// differing only in whether the outrigger was built at all. The one that was
// built sheds it on the first tick, when all six of its props break together, and
// what is left standing there is the strut between its two nodes and the two
// counterweights on them. Both runs are read on the same tick, and every member
// the crane kept must read the same in both: `poseCrane` places the design in
// order, so the crane's own members carry the same ids in both runs and the
// assembly's are appended after them.
//
// A build that left a fallen member's half masses in the load model would move
// nothing here at all — the assembly hangs off the anchors — which is exactly why
// the assembly is propped on anchors instead: it makes the two runs comparable,
// so any difference is the fallen member's weight and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertLength, fail } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  createHarness,
  openSite,
  poseCrane,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type GantrySnapshot,
  type Harness,
} from "../harness";

/**
 * The rig every reading below is taken on, and why it is shaped this way.
 *
 * It is a plain crane, built under the rules of `specs/structure.md` alone, but
 * three of its nodes are arranged so that one member's force is fixed by a single
 * equation rather than by the whole solve, which is what lets a reading be
 * compared against a figure the specification states:
 *
 *   - The tower is the braced box from the four anchors to the ring's bottom
 *     flange at `(0, 4, 0)`. The bottom-flange corner `(0, 4, 0)` is reached by
 *     its vertical leg (id 0) and by horizontals alone, so vertical equilibrium
 *     there reads `N = F.y` on that leg and on nothing else.
 *   - The arm is a mast head at `(2, 10, 0)` tied to all four top-flange nodes, a
 *     spur node at `(4, 6, 2)`, and the track `(4, 6, 0)-(6, 6, 0)-(8, 6, 0)`.
 *   - Each of the three track nodes is hung from the mast by ONE cable — the only
 *     member at that node with a `y` component — and braced sideways by
 *     horizontals, one of which is the only member there with a `z` component. So
 *     the cable carries the whole vertical load lumped at its node, `V / |n.y|`,
 *     and the sideways brace the whole `z` load.
 *   - The track origin is `(4, 6, 0)`, the end nearer the slew axis, and it is an
 *     ordinary arm node carrying exactly one rail — so the rail's force follows
 *     from that node's `x` equilibrium once the other two are known.
 *
 * Every node lies inside the envelope of the site each reading opens, the crane
 * costs well under that site's budget, and `check` reports no issue and a
 * structure that stands.
 */
const RIG: CraneDesign = {
  site: 1,
  name: "Reference rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: [
    // The tower: four legs, the bottom-flange square and one diagonal across it,
    // and one diagonal on each of the box's four sides.
    [[0, 0, 0], [0, 4, 0], "strut"],
    [[2, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 2], [0, 4, 2], "strut"],
    [[2, 0, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 0], "strut"],
    [[0, 4, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[2, 4, 0], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 2], "strut"],
    [[0, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 0], [0, 4, 2], "strut"],
    [[2, 0, 0], [2, 4, 2], "strut"],
    [[0, 0, 2], [2, 4, 2], "strut"],
    // The mast head, tied to all four top-flange nodes.
    [[2, 6, 0], [2, 10, 0], "strut"],
    [[0, 6, 0], [2, 10, 0], "strut"],
    [[2, 6, 2], [2, 10, 0], "strut"],
    [[0, 6, 2], [2, 10, 0], "strut"],
    // The spur node the outboard sideways braces run back to.
    [[2, 6, 2], [4, 6, 2], "strut"],
    [[2, 6, 0], [4, 6, 2], "strut"],
    [[2, 10, 0], [4, 6, 2], "strut"],
    // The track, and the cable and the sideways brace at each of its nodes.
    [[4, 6, 0], [6, 6, 0], "rail"],
    [[6, 6, 0], [8, 6, 0], "rail"],
    [[2, 10, 0], [4, 6, 0], "cable"],
    [[2, 6, 2], [4, 6, 0], "strut"],
    [[2, 10, 0], [6, 6, 0], "cable"],
    [[2, 6, 2], [6, 6, 0], "strut"],
    [[2, 10, 0], [8, 6, 0], "cable"],
    [[4, 6, 2], [8, 6, 0], "strut"],
    [[4, 6, 2], [6, 6, 0], "strut"],
  ],
  tape: [],
};

/**
 * A pair of outrigger nodes the crane sheds on its first tick, and the member
 * between them that survives the fall.
 *
 * Each node carries a counterweight and is propped on three struts down to three
 * of the site's anchors. Those three directions resolve the node's weight — one
 * `COUNTERWEIGHT_MASS` and its members' halves — into forces two and a half to
 * three times what a strut of that length bears, so all six props are past their
 * capacity on the first solve and `specs/statics.md` removes "all of them at
 * once". What is left is two nodes no intact member ends at, and the strut
 * between them, joined to neither the arm nor the tower.
 *
 * `(6, 2, -2)` is `(4, 2, -2)` moved by `(2, 0, 0)`, and so are its three
 * anchors, so the two nodes stand in identical surroundings under identical load
 * and the strut between them lies along the offset that relates them.
 *
 * The whole assembly meets the crane only at anchor nodes, which the tower solve
 * holds at zero displacement, so nothing it does reaches the crane's own members
 * either before the fall or after it. That is what lets a reading after the fall
 * be compared against the same crane with the assembly never built.
 */
const OUTRIGGER: readonly DesignMember[] = [
  [[0, 0, 0], [4, 2, -2], "strut"],
  [[0, 0, 2], [4, 2, -2], "strut"],
  [[2, 0, 2], [4, 2, -2], "strut"],
  [[2, 0, 0], [6, 2, -2], "strut"],
  [[2, 0, 2], [6, 2, -2], "strut"],
  [[4, 0, 2], [6, 2, -2], "strut"],
  [[4, 2, -2], [6, 2, -2], "strut"],
];

/** The rig with the outrigger built on it, and a counterweight on each node. */
const RIGGED: CraneDesign = {
  ...RIG,
  name: "Reference rig with the outrigger",
  counterweights: [
    [4, 2, -2],
    [6, 2, -2],
  ],
  members: [...RIG.members, ...OUTRIGGER],
};

/** The six props that hold the two nodes up. */
const PROPS = [29, 30, 31, 32, 33, 34];

/**
 * Heavy Haul, whose nine anchors carry the outrigger.
 *
 * The pair needs an anchor set that survives being moved by `(2, 0, 0)`, which
 * the three-by-three grid `specs/sites.md` gives this site and no other does.
 * The rig itself stands on the same four anchors it stands on anywhere.
 */
const SITE = 5;

/** A tape long enough that the run is still going when the reading is taken. */
const LIFT_TARGET = 6;

/** The tick each reading is taken on, comfortably past the fall. */
const READING_TICK = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Run `design` and read the tick the comparison is made on.
 *
 * The structure poses apply on the build screen and the tape poses on the program
 * screen (specs/instrumentation.md), so the screen is taken to each in turn and
 * left on the program screen — `specs/program.md` allows a run to start from
 * either. `poseCrane` empties the structure itself, and the tape is emptied here,
 * so the second run is posed on the same clean slate as the first.
 */
async function runCrane(design: CraneDesign): Promise<GantrySnapshot> {
  await h.debug.setScreen("build");
  await poseCrane(h, design);
  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await h.debug.addMoveStep("hoist", LIFT_TARGET, HOIST_MAX_RATE);
  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the one lift step this reading's tape carries (specs/program.md)",
  );
  return runTicks(h, READING_TICK);
}

it("reads the same as the crane with the fallen assembly never built", async () => {
  await openSite(h, SITE);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();

  const shed = await runCrane(RIGGED);
  await h.capture(
    "crane-after-the-fall",
    "the crane carrying on after the outrigger and its counterweights fell",
  );
  assertEqual(
    shed.run.phase,
    "running",
    "the phase of the run the assembly fell off (specs/statics.md)",
  );
  assertEqual(
    shed.run.broken.length,
    PROPS.length,
    "the members the fall broke: the six props and nothing else " +
      "(specs/statics.md)",
  );

  await h.debug.abortRun();
  const never = await runCrane(RIG);
  assertEqual(
    never.run.phase,
    "running",
    "the phase of the run with the assembly never built (specs/program.md)",
  );
  assertEqual(
    never.run.tick,
    shed.run.tick,
    "the tick both readings are taken on",
  );

  for (const member of never.run.forces) {
    const after = shed.run.forces.find((one) => one.id === member.id);
    if (after === undefined) {
      fail(
        `member ${member.id} to have survived the fall (specs/statics.md)`,
        "it is missing from the run that shed the assembly",
      );
    }
    assertClose(
      after.force,
      member.force,
      1e-6,
      `member ${member.id}'s force, which the fallen assembly's mass and its ` +
        "counterweights cannot reach (specs/statics.md)",
    );
  }
});
