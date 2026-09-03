// simulation/corner-pairing-is-fixed — a ring corner pairs the same two nodes at
// every slew angle.
//
// specs/structure.md: "A corner pairs the same two nodes for the life of the crane.
// The top flange turns and the bottom flange does not, so a corner's two nodes
// stand over one another at slew `0` and not at a general slew angle; the pairing
// is the ring's, not a reading of where the nodes currently are." specs/statics.md
// says what crosses: "at each bottom-flange node, the negated reaction read at the
// top-flange node it shares a ring corner with ... The corner pairing is the
// ring's own and holds at every slew angle."
//
// The trolley begins every run at the track's origin, which here is the top-flange
// node `(2, 6, 0)`, and specs/statics.md applies the cable force at the trolley
// point and shares the trolley's mass "between the two nodes of the rail member the
// trolley is on ... at a shared node it belongs wholly to that node". So the whole
// of the cable force lands on one top-flange node, and the corner carries it to
// `(2, 4, 0)` — a bottom-flange corner braced by horizontals alone, whose vertical
// leg therefore reads the crossed load exactly.
//
// Hanging a load of mass 95 on the bare hook takes the cable force from
// `HOOK_MASS * GRAVITY` to `(HOOK_MASS + 95) * GRAVITY`, 950 force units more,
// with the bob posed at rest below the pivot so the cable pulls straight down
// (specs/rigging.md: "Hanging at rest this is the bob's weight, straight down").
// The reading is repeated at slew 0, 45, 90 and 180 — each reached by running the
// tape rather than by posing the angle, so the pendulum never gets a jolt — and at
// every one of them the same leg must take the whole 950. A build that read the
// pairing off where the turned top flange currently stands would send it to a
// different leg at 90 and to the opposite corner at 180.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue } from "../assert";
import { GRAVITY, GRIP_MAX_RATE, HOIST_START, HOOK_MASS, SLEW_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  runUntil,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The span a force in the hundreds is read to. */
const TOLERANCE = 1e-6;

/** The mass hung on the hook, and the extra cable force it makes. */
const LOAD_MASS = 95;
const EXTRA = LOAD_MASS * GRAVITY;

/** The bottom-flange corner the trolley's top-flange node is paired with. */
const CORNER = { x: 2, y: 4, z: 0 };

/** The angles the reading is repeated at. */
const ANGLES = [0, 45, 90, 180] as const;

/**
 * The jib rig, mirrored in `x` so the corner under the track's origin is bare.
 *
 * The tower is the box between the site's four anchors and the ring's bottom
 * flange at `y = 4`, braced the way a cube on a fixed base has to be so the tower
 * solve is not a mechanism (specs/statics.md, "Singularity") — but with the three
 * inclined anchor braces and the flange diagonal placed so that `(2, 4, 0)` carries
 * its vertical leg and horizontal members alone. That is the bottom-flange node
 * the ring pairs with `(2, 6, 0)`, which is the track's origin and so where the
 * trolley stands at a run's start (specs/structure.md, specs/program.md). At such a
 * corner the leg is the only member with a vertical component, so its force is
 * exactly minus the whole vertical load applied at the node.
 *
 * The arm is a mast head at `(2, 10, 0)` braced back to three top-flange nodes, a
 * two-rail track running out along `+x` from `(2, 6, 0)`, and each outboard rail
 * node hung from the mast head by a cable and braced sideways to `(2, 6, 2)`.
 */
const RIG_MEMBERS: readonly DesignMember[] = [
  [[0, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [0, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 0], "strut"],
  [[0, 4, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [0, 4, 2], "strut"],
  [[2, 4, 0], [2, 4, 2], "strut"],
  [[2, 4, 0], [0, 4, 2], "strut"],
  [[2, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 2], [0, 4, 2], "strut"],
  [[0, 0, 2], [0, 4, 0], "strut"],
  [[2, 6, 0], [2, 10, 0], "strut"],
  [[2, 10, 0], [2, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 0], "strut"],
  [[2, 6, 0], [4, 6, 0], "rail"],
  [[4, 6, 0], [6, 6, 0], "rail"],
  [[2, 10, 0], [4, 6, 0], "cable"],
  [[2, 10, 0], [6, 6, 0], "cable"],
  [[4, 6, 0], [2, 6, 2], "strut"],
  [[6, 6, 0], [2, 6, 2], "strut"],
];

const RIG: CraneDesign = {
  site: 1,
  name: "Bare-corner jib rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: RIG_MEMBERS,
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the trolley's cable force to the same bottom-flange leg at every slew angle", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RIG);
  await addOneLoad(
    h,
    "crate",
    LOAD_MASS,
    { x: 20, y: 2, z: 0, yaw: 0 },
    { x: 20, y: 2, z: 0, yaw: 0 },
  );

  const { structure } = await h.snapshot();
  const leg = structure.members.find((m) => {
    const [low, high] = m.a.y < m.b.y ? [m.a, m.b] : [m.b, m.a];
    return (
      low.y === 0 && high.x === CORNER.x && high.y === CORNER.y &&
      high.z === CORNER.z && low.x === CORNER.x && low.z === CORNER.z
    );
  });
  if (leg === undefined) {
    throw new Error("gantry: the rig has no leg under (2, 4, 0)");
  }

  /**
   * Hang the bob at rest below the pivot and read the solve two ticks later.
   *
   * Two, not one: the bob's acceleration for a tick is `(v - v_prev) / dt`
   * (specs/rigging.md), so the first tick after a pose is measured against
   * whatever the bob was doing before it. The tick after that has a settled
   * `v_prev`, the acceleration is zero, and the cable force is the bob's weight
   * straight down — which is what makes the two readings differ by the hung
   * load's weight and by nothing else.
   */
  const readAtRest = async () => {
    const before = await h.snapshot();
    await h.debug.setBob(
      before.run.pivot.x,
      before.run.pivot.y - HOIST_START,
      before.run.pivot.z,
    );
    await h.debug.setBobVelocity(0, 0, 0);
    const after = await runTicks(h, 3);
    assertTrue(
      after.run.phase === "running",
      "the run still standing while the reading is taken",
    );
    return new Map(after.run.forces.map((f) => [f.id, f.force]));
  };

  for (const angle of ANGLES) {
    await h.debug.abortRun();
    // The tape poses apply on the program screen alone
    // (specs/instrumentation.md), and an abort leaves the build screen showing.
    await h.debug.setScreen("program");
    await h.debug.clearProgram();
    const tape: readonly TapeStepSpec[] = [
      { kind: "move", commands: [{ axis: "slew", target: angle, rate: SLEW_MAX_RATE }] },
      { kind: "move", commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }] },
    ];
    await poseTape(h, tape);
    await startRun(h);
    const arrived = await runUntil(
      h,
      (s) =>
        s.run.tick >= 2 &&
        s.run.axes.slew.rate === 0 &&
        Math.abs(s.run.axes.slew.value - angle) <= 1e-9,
      1200,
      `the slew to arrive at ${angle} degrees`,
    );
    assertNear(
      arrived.run.axes.slew.value,
      angle,
      1e-9,
      `the slew value the tape drove to (${angle} degrees)`,
    );

    const bare = await readAtRest();
    await h.debug.setLoadPhase(0, "attached");
    const loaded = await readAtRest();

    for (const [id, force] of loaded) {
      const was = bare.get(id);
      if (was === undefined) continue;
      const expected = id === leg.id ? -EXTRA : 0;
      assertNear(
        force - was,
        expected,
        TOLERANCE,
        `at slew ${angle} degrees, member ${id}` +
          (id === leg.id
            ? ` — the leg under (${CORNER.x}, ${CORNER.y}, ${CORNER.z}), the ` +
              "corner the trolley's top-flange node is paired with — taking the " +
              `whole ${EXTRA} the hung load adds to the cable force`
            : " taking none of the load the corner carries down " +
              "(specs/structure.md: the pairing is the ring's own)"),
      );
    }
  }

  await h.capture(
    "corner-pairing",
    "The rig at slew 180 with a load on the hook, the turned trolley's load " +
      "still crossing its own ring corner",
  );
});
