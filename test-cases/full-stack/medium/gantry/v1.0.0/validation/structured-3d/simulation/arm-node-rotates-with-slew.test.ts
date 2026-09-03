// simulation/arm-node-rotates-with-slew — an arm node stands at its lattice
// position turned by the slew angle, about the slew axis.
//
// specs/statics.md, "Geometry at a tick": "Arm nodes turn with the slew angle:
// with the slew axis through `(ax, ·, az)` and `theta` the slew value, converted
// to radians for these formulas, a node placed at `(x, y, z)` stands at
// `x' = ax + (x - ax) * cos(theta) - (z - az) * sin(theta)`,
// `z' = az + (x - ax) * sin(theta) + (z - az) * cos(theta)`, `y' = y` — so a
// positive `theta` turns `+x` toward `+z`". specs/structure.md puts the axis at
// "the vertical line through the flange square's center,
// `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)`", and says "The rail track,
// the trolley point, and the pivot the cable hangs from all follow this rotation".
//
// The pivot is the arm node this check reads, because it is the one the snapshot
// reports (specs/state.md). The tape drives the trolley out to the track's far end
// first, so the pivot sits at the outboard rail node `(6, 6, 0)` — five units out
// along `+x` from the axis, where a sign error in the formula is a six-unit miss
// rather than a rounding one — and then slews to 90 degrees, where the whole of a
// node's `+x` offset has become a `+z` offset. Driving the angle with the tape
// rather than posing it keeps the pendulum on its own rules the whole way.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertVec3Near } from "../assert";
import {
  GRIP_MAX_RATE,
  LATTICE_PITCH,
  SLEW_MAX_RATE,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runUntil,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The span a world position is read to. */
const TOLERANCE = 1e-6;

/** The angle the tape drives the arm to. */
const ANGLE = 90;

/** The trolley's distance along the track: its far end. */
const TROLLEY = 4;

/** The lattice node the trolley stands on at that distance. */
const NODE = { x: 6, y: 6, z: 0 };

/**
 * The jib rig, and why it is shaped this way.
 *
 * The tower is the box between the site's four ground anchors and the slew ring's
 * bottom flange at `y = 4`: a vertical leg under each bottom-flange node, the four
 * flange horizontals with one diagonal across them, and three inclined anchor
 * braces — the bracing a cube on a fixed base needs so the tower solve is not a
 * mechanism (specs/statics.md, "Singularity"). The two braces are placed so the
 * corners `(0, 4, 0)` and `(0, 4, 2)` carry their vertical leg and horizontal
 * members alone: at such a corner the leg is the only member with a vertical
 * component, so vertical equilibrium there fixes the leg's force at exactly minus
 * the whole vertical load applied at the node, whatever the rest of the tower does.
 *
 * The arm is a mast head at `(2, 10, 0)` braced back to three top-flange nodes, a
 * two-rail track running out along `+x` from the top-flange node `(2, 6, 0)`, each
 * outboard rail node hung from the mast head by one cable and braced sideways by
 * one horizontal strut back to `(2, 6, 2)`. At `(4, 6, 0)` and `(6, 6, 0)` that
 * mast cable is the only member with a vertical component and that sideways brace
 * the only member with a `z` component, so each of those two equilibria is a
 * single-member reading as well.
 *
 * Every node lies inside site 1's envelope and the crane costs `1066.40` against a
 * budget of `3000`.
 */
const JIB_RIG_MEMBERS: readonly DesignMember[] = [
  // The tower: four legs, the flange square with one diagonal, three braces.
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
  [[0, 0, 2], [2, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 0], "strut"],
  // The arm: the mast head and its braces.
  [[2, 6, 0], [2, 10, 0], "strut"],
  [[2, 10, 0], [2, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 0], "strut"],
  // The arm: the track, its mast cables, and its sideways braces.
  [[2, 6, 0], [4, 6, 0], "rail"],
  [[4, 6, 0], [6, 6, 0], "rail"],
  [[2, 10, 0], [4, 6, 0], "cable"],
  [[2, 10, 0], [6, 6, 0], "cable"],
  [[4, 6, 0], [2, 6, 2], "strut"],
  [[6, 6, 0], [2, 6, 2], "strut"],
];

const JIB_RIG: CraneDesign = {
  site: 1,
  name: "Jib rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: JIB_RIG_MEMBERS,
  tape: [],
};

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "trolley", target: TROLLEY, rate: TROLLEY_MAX_RATE }] },
  { kind: "move", commands: [{ axis: "slew", target: ANGLE, rate: SLEW_MAX_RATE }] },
  { kind: "move", commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands an arm node at its lattice position turned about the slew axis", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, JIB_RIG);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const ring = started.structure.ring;
  if (ring === null) {
    throw new Error("gantry: the posed rig carries no ring");
  }
  const axis = {
    x: ring.corner.x + LATTICE_PITCH / 2,
    z: ring.corner.z + LATTICE_PITCH / 2,
  };

  const turned = await runUntil(
    h,
    (s) =>
      s.run.axes.slew.rate === 0 &&
      Math.abs(s.run.axes.slew.value - ANGLE) <= 1e-9 &&
      Math.abs(s.run.axes.trolley.value - TROLLEY) <= 1e-9,
    1200,
    `the tape to run the trolley out and slew to ${ANGLE} degrees`,
  );

  const theta = (ANGLE * Math.PI) / 180;
  const expected = {
    x: axis.x + (NODE.x - axis.x) * Math.cos(theta) - (NODE.z - axis.z) * Math.sin(theta),
    y: NODE.y,
    z: axis.z + (NODE.x - axis.x) * Math.sin(theta) + (NODE.z - axis.z) * Math.cos(theta),
  };

  assertVec3Near(
    turned.run.pivot,
    expected,
    TOLERANCE,
    `the trolley point, the arm node (${NODE.x}, ${NODE.y}, ${NODE.z}) turned ` +
      `by ${ANGLE} degrees about the slew axis at (${axis.x}, ·, ${axis.z}) ` +
      "(specs/statics.md)",
  );
  assertNear(turned.run.pivot.y, NODE.y, TOLERANCE, "the height a slew leaves alone");
  assertGreaterThan(
    turned.run.pivot.z,
    axis.z,
    "the pivot standing on the +z side of the slew axis, since a positive slew " +
      "turns +x toward +z (specs/statics.md, specs/world.md)",
  );

  await h.capture(
    "arm-turned",
    "The jib rig with its arm turned 90 degrees and the trolley at the far end",
  );
});
