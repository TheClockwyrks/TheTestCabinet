// check/check-reports-a-utilization-above-one — the check reports a utilization
// above `1` as it stands.
//
// specs/structure.md § The static check closes with it: "Nothing breaks and
// nothing fails during a check: a utilization above `1` is reported and no more."
// So the figure is neither clamped at `1`, nor hidden, nor grounds for leaving
// the member out of the list.
//
// THE OVERLOAD IS THE CRANE'S OWN WEIGHT. The harness's minimal crane carries a
// counterweight on every one of the fourteen nodes it uses — each a node a member
// ends at or a flange node of the ring, which is what specs/structure.md §
// Counterweights allows — for `14 * COUNTERWEIGHT_MASS` (`1120`) of added mass on
// top of the roughly `90` the members, the ring and the trolley carry. Under
// `GRAVITY` (`10`) that is some twelve thousand force units, and the whole of it
// reaches the ground through the tower's four legs, so each leg carries about
// three thousand in compression. A leg is a strut two units long, and
// `min(1, (BUCKLE_REF / L)^2)` is `1` at `L = 2`, so its compression capacity is
// the full `STRUT_CAP_COMPRESSION` (`2400`): the legs are loaded past it. The
// crane is nonetheless a braced 3D truss, so both solves stay regular and the
// structure still stands — which is the whole point, since a check "reads the
// structure as it stands" and breaks nothing.
//
// The leg read is the one on the loaded side, under the arm that cantilevers out
// to `+x`. The reported utilization is checked against the reported force through
// specs/statics.md § Utilization and breakage, `-N / capacityCompression(L)`, so a
// build that clamped the figure while reporting the force it came from fails.
//
// The crane costs `1541.43` against site 1's `3000` budget, so no edit is refused
// (specs/structure.md § Cost and the budget).

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertNearFraction,
  assertNotNull,
  assertTrue,
} from "../assert";
import { BUCKLE_REF, STRUT_CAP_COMPRESSION } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
  type LatticeNode,
} from "../harness";

const SITE = 0;

/** Every node the minimal crane uses: a member end, or a flange node. */
const EVERY_NODE: readonly LatticeNode[] = [
  [0, 0, 0],
  [2, 0, 0],
  [0, 0, 2],
  [2, 0, 2],
  [0, 2, 0],
  [2, 2, 0],
  [0, 2, 2],
  [2, 2, 2],
  [0, 4, 0],
  [2, 4, 0],
  [0, 4, 2],
  [2, 4, 2],
  [0, 8, 0],
  [4, 4, 0],
];

const LADEN: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with a counterweight on every node",
  counterweights: EVERY_NODE,
};

/** The tower leg under the cantilevered arm: anchor `(2,0,0)` to `(2,2,0)`. */
const LOADED_LEG = { ax: 2, ay: 0, az: 0, bx: 2, by: 2, bz: 0 } as const;

/** Two ends, in an order that reads the same either way round. */
function ends(a: { x: number; y: number; z: number }, b: typeof a): string {
  const one = `${a.x},${a.y},${a.z}`;
  const two = `${b.x},${b.y},${b.z}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports an overloaded member's utilization above 1, unclamped", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, LADEN);

  const result = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "the-member-s-id-force-and-utilization-stable",
    "the member's id, force and utilization, stable.",
  );

  const wanted = ends(
    { x: LOADED_LEG.ax, y: LOADED_LEG.ay, z: LOADED_LEG.az },
    { x: LOADED_LEG.bx, y: LOADED_LEG.by, z: LOADED_LEG.bz },
  );
  const leg = structure.members.find((one) => ends(one.a, one.b) === wanted);
  assertNotNull(
    leg,
    "the tower leg from (2, 0, 0) to (2, 2, 0) the crane holds",
  );

  const reported = result.members.find((one) => one.id === leg?.id);
  assertNotNull(
    reported,
    `member ${leg?.id}, the overloaded leg, among the members the check ` +
      "reports (specs/structure.md § The static check)",
  );

  const length = distance3(leg!.a, leg!.b);
  const capacity =
    STRUT_CAP_COMPRESSION * Math.min(1, (BUCKLE_REF / length) ** 2);

  assertTrue(
    reported!.force < 0,
    "the leg carries its share of the crane's weight in compression, so its " +
      "force is negative (specs/statics.md)",
  );
  // A tenth of a percent: the two figures are one division apart, and nothing
  // in the specification fixes the precision either is reported at, while the
  // deviation this is here to catch — a figure clamped at `1` — is a fifth of
  // the reading.
  assertNearFraction(
    reported!.utilization,
    -reported!.force / capacity,
    1e-3,
    `the utilization the reported force and the length-reduced compression ` +
      `capacity give, ${capacity} at L = ${length} ` +
      "(specs/statics.md § Utilization and breakage)",
  );
  assertGreaterThan(
    reported!.utilization,
    1,
    "the utilization of a leg loaded past its capacity, reported as it stands " +
      "rather than clamped (specs/structure.md § The static check)",
  );
  assertTrue(
    result.stable,
    "the verdict on a structure whose solves are both regular; a check breaks " +
      "nothing (specs/structure.md § The static check)",
  );
});
