// simulation/anchors-carry-any-force — an anchor takes whatever reaction the
// structure hands it, and no run ends on the anchors' account.
//
// specs/world.md: "An anchor is the one kind of support the structure has ... in
// the solve an anchor node is held immovable ... Anchors support any force without
// limit; what fails under load is the structure, never the ground."
// specs/statics.md's failure causes bear that out from the other side: the closed
// vocabulary carries `collapse`, `ring-overload` and the collision causes, and
// nothing for a support. The only capacity the game checks a reaction against is
// `RING_CAP` (`6000`) at the four ring connections (specs/structure.md), and that
// check is on the arm's reactions at the top flange, not on the ground.
//
// The crane is the jib rig with a counterweighted cluster hung off the -x/-z side
// of the tower and one counterweight on the anchor `(0, 0, 0)` itself, so that
// anchor's reaction runs well past `RING_CAP` while every member stays under its
// own capacity. The reaction is not reported, so the check computes it from the
// forces the build itself reports — the anchor's own applied weight plus every
// member force pulling on it — which is the specification's own definition
// ("the reaction at a support node is minus the sum of the applied force there and
// every member force pulling on it"). That reading is the scenario's precondition;
// what the check then decides is that the run carries on regardless.
//
// The tape is a single grip move. specs/rigging.md: "Turning the grip applies no
// force to anything", so the run is a few hundred ticks of the structure standing
// under its own load and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength, assertTrue } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  COUNTERWEIGHT_MASS,
  GRAVITY,
  GRIP_MAX_RATE,
  RAIL_MASS_PER_UNIT,
  RING_CAP,
  STRUT_MASS_PER_UNIT,
} from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseCrane,
  poseTape,
  runUntil,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type MaterialName,
  type TapeStepSpec,
} from "../harness";

/** specs/structure.md's mass per unit, by material. */
const MASS_PER_UNIT: Readonly<Record<MaterialName, number>> = {
  strut: STRUT_MASS_PER_UNIT,
  cable: CABLE_MASS_PER_UNIT,
  rail: RAIL_MASS_PER_UNIT,
};

/** The anchor the load is funnelled into. */
const ANCHOR = { x: 0, y: 0, z: 0 };

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

/** The counterweighted cluster the tower carries out to -x and -z. */
const CLUSTER: readonly DesignMember[] = [
  [[-2, 2, 0], [0, 0, 0], "strut"],
  [[-2, 2, 0], [0, 0, 2], "strut"],
  [[-2, 2, 0], [2, 0, 0], "strut"],
  [[0, 2, -2], [0, 0, 0], "strut"],
  [[0, 2, -2], [2, 0, 0], "strut"],
  [[0, 2, -2], [0, 0, 2], "strut"],
  [[-2, 2, -2], [0, 0, 0], "strut"],
  [[-2, 2, -2], [2, 0, 0], "strut"],
  [[-2, 2, -2], [0, 0, 2], "strut"],
  [[-2, 2, 0], [0, 4, 0], "strut"],
  [[0, 2, -2], [0, 4, 0], "strut"],
  [[-2, 2, -2], [0, 4, 0], "strut"],
  [[-2, 2, 0], [-2, 2, -2], "strut"],
  [[0, 2, -2], [-2, 2, -2], "strut"],
  [[-2, 2, 0], [0, 2, -2], "strut"],
  [[-2, 2, 0], [0, 2, 0], "strut"],
  [[0, 2, -2], [0, 2, 0], "strut"],
  [[0, 2, 0], [0, 0, 0], "strut"],
  [[0, 2, 0], [2, 0, 0], "strut"],
  [[0, 2, 0], [0, 0, 2], "strut"],
  [[0, 2, 0], [0, 4, 0], "strut"],
];

const LOADED_ANCHOR_CRANE: CraneDesign = {
  ...JIB_RIG,
  name: "Loaded-anchor crane",
  members: [...JIB_RIG_MEMBERS, ...CLUSTER],
  counterweights: [
    [-2, 2, 0],
    [0, 2, -2],
    [-2, 2, -2],
    [0, 2, 0],
    [0, 4, 0],
    [0, 0, 0],
  ],
};

/** One move that turns the hook and applies no force to the structure. */
const GRIP_TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 180, rate: GRIP_MAX_RATE }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a reaction past RING_CAP at one anchor without ending the run", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, LOADED_ANCHOR_CRANE);

  const { structure } = await h.snapshot();
  const result = await h.check();
  assertTrue(result.stable, "the loaded-anchor crane stands");

  // The scenario's precondition, computed the way specs/statics.md defines a
  // reaction, from the forces the build reports.
  const at = (p: { x: number; y: number; z: number }) =>
    p.x === ANCHOR.x && p.y === ANCHOR.y && p.z === ANCHOR.z;
  const byId = new Map(structure.members.map((m) => [m.id, m]));
  let mass = structure.counterweights.some(at) ? COUNTERWEIGHT_MASS : 0;
  let pull = { x: 0, y: 0, z: 0 };
  let worst = 0;
  for (const reading of result.members) {
    worst = Math.max(worst, reading.utilization);
    const member = byId.get(reading.id);
    if (member === undefined || (!at(member.a) && !at(member.b))) continue;
    const other = at(member.a) ? member.b : member.a;
    const length = distance3(member.a, member.b);
    mass += (length * MASS_PER_UNIT[member.material]) / 2;
    pull = {
      x: pull.x + (reading.force * (other.x - ANCHOR.x)) / length,
      y: pull.y + (reading.force * (other.y - ANCHOR.y)) / length,
      z: pull.z + (reading.force * (other.z - ANCHOR.z)) / length,
    };
  }
  const reaction = Math.hypot(pull.x, pull.y - mass * GRAVITY, pull.z);
  assertGreaterThan(
    reaction,
    RING_CAP,
    `the reaction the structure hands the anchor at (${ANCHOR.x}, ${ANCHOR.y}, ` +
      `${ANCHOR.z}) to run past RING_CAP (${RING_CAP}), the largest capacity the ` +
      "game names, so this run is genuinely asking the ground for more than any " +
      "part of the crane could bear",
  );
  assertTrue(
    worst <= 1,
    `every member of the loaded-anchor crane under its own capacity — the worst ` +
      `utilization is ${worst.toFixed(4)} — so nothing that follows is the ` +
      "structure failing",
  );

  await poseTape(h, GRIP_TAPE);
  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    2000,
    "the run to end as the tape does",
  );

  assertEqual(
    ended.run.phase,
    "cleared",
    "the run ending as its tape does rather than on the anchor's account " +
      "(specs/world.md: anchors support any force without limit)",
  );
  assertEqual(ended.run.cause, null, "the cause a run under a loaded anchor carries");
  assertLength(
    ended.run.broken,
    0,
    "the members broken while the anchor carried a reaction past RING_CAP",
  );

  await h.capture(
    "loaded-anchor",
    "The crane whose counterweighted cluster funnels its load into one anchor",
  );
});
