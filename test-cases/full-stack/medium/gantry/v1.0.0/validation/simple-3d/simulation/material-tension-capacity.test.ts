// simulation/material-tension-capacity — a member in tension is scored against
// its own material's tension capacity.
//
// specs/statics.md fixes the readout: "utilization = N / capacityTension when
// N >= 0". specs/structure.md fixes the three capacities:
// `STRUT_CAP_TENSION` (`2400`), `CABLE_CAP_TENSION` (`3600`) and
// `RAIL_CAP_TENSION` (`2400`). The cable is the one that differs, so a build that
// scored every material against one figure — or that swapped the cable's for a
// strut's — would report a cable half again as close to breaking as it is.
//
// Two cranes are posed, because no single one puts all three materials in tension.
// The jib rig hangs its track from a mast head, which pulls its mast braces and
// its cables in tension. The tied-jib rig props its track up from the top flange
// instead, so the props push and the rails are the tie that holds them apart —
// which is the only ordinary way a rail stands in tension. Every member either
// crane reports in tension is checked, so the reading is over the whole structure
// rather than over one member picked to suit.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import {
  CABLE_CAP_TENSION,
  RAIL_CAP_TENSION,
  STRUT_CAP_TENSION,
} from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type MaterialName,
} from "../harness";

/** The relative span a reported utilization is read against. */
const TOLERANCE = 1e-9;

/** Below this a force is round-off rather than a tension worth scoring. */
const FLOOR = 1e-6;

/** specs/structure.md's tension capacity, by material. */
const CAP_TENSION: Readonly<Record<MaterialName, number>> = {
  strut: STRUT_CAP_TENSION,
  cable: CABLE_CAP_TENSION,
  rail: RAIL_CAP_TENSION,
};

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

/**
 * The same tower carrying a tied jib: the track is propped up from the top flange
 * rather than hung from a mast, so the props stand in compression and the rails
 * are the tie that carries their outward thrust — rails in tension.
 */
const TIED_JIB: CraneDesign = {
  ...JIB_RIG,
  name: "Tied-jib rig",
  members: [
    ...JIB_RIG_MEMBERS.filter((m) => m[0][1] < 6 && m[1][1] < 6),
    [[0, 6, 0], [2, 8, 0], "strut"],
    [[2, 6, 2], [2, 8, 0], "strut"],
    [[0, 6, 2], [2, 8, 0], "strut"],
    [[2, 8, 0], [4, 8, 0], "rail"],
    [[4, 8, 0], [6, 8, 0], "rail"],
    [[2, 6, 2], [4, 8, 0], "strut"],
    [[2, 6, 0], [4, 8, 0], "strut"],
    [[2, 6, 2], [6, 8, 0], "strut"],
    [[2, 6, 0], [6, 8, 0], "strut"],
  ],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scores a member in tension against its own material's tension capacity", async () => {
  await openSite(h, 0);
  // The yard once, rather than once per crane: `poseCrane` empties the structure
  // itself before it builds, and the loads and obstacles neither crane concerns
  // do not come back between the two poses.
  await emptyYard(h);

  const seen: Record<MaterialName, number> = { strut: 0, cable: 0, rail: 0 };

  const score = async (design: CraneDesign) => {
    await poseCrane(h, design);
    const { structure } = await h.snapshot();
    const result = await h.check();
    assertTrue(
      result.stable,
      `the ${design.name} stands, so the check solves it`,
    );
    const byId = new Map(structure.members.map((m) => [m.id, m]));
    for (const reading of result.members) {
      const member = byId.get(reading.id);
      if (member === undefined || reading.force <= FLOOR) continue;
      const capacity = CAP_TENSION[member.material];
      seen[member.material] += 1;
      assertNear(
        reading.utilization,
        reading.force / capacity,
        (reading.force / capacity) * TOLERANCE,
        `member ${reading.id} of the ${design.name}, a ${member.material} ` +
          `carrying ${reading.force.toFixed(4)} in tension, scored against ` +
          `${capacity} (specs/statics.md, specs/structure.md)`,
      );
    }
  };

  await score(JIB_RIG);
  await score(TIED_JIB);

  await h.advance(1);
  await h.capture(
    "material-capacities",
    "The tied-jib rig, whose rails carry the props' outward thrust in tension",
  );

  for (const material of ["strut", "cable", "rail"] as const) {
    assertGreaterThan(
      seen[material],
      0,
      `${material} members standing in tension across the two cranes, so each ` +
        "material's capacity is genuinely read",
    );
  }
});
