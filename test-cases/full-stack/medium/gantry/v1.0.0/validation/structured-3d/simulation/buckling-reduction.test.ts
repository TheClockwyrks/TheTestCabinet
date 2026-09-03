// simulation/buckling-reduction — a long strut's compression capacity falls with
// the square of its length.
//
// specs/structure.md: "a member of length `L` bears compression up to its
// compression capacity times `min(1, (BUCKLE_REF / L)^2)`, with `BUCKLE_REF`
// (`4`), so a long strut buckles under a fraction of what a short one holds." At
// length 6 — a strut's own `STRUT_MAX_LEN` — that factor is `(4 / 6)^2`, so the
// capacity a compression is scored against is `2400 * 4 / 9`, `1066.67`, and a
// build that skipped the reduction would report a utilization 2.25 times too
// small on exactly the members closest to buckling.
//
// The crane is a tower whose four anchors carry BOTH a length-6 leg straight up
// to the ring's bottom flange at `y = 6` and a length-4 leg to a braced inner
// frame at `y = 4`. specs/structure.md allows this: "two members whose segments
// cross in space are not joined there and pass through one another freely", so
// the long leg runs past the `y = 4` node without touching it, and the two legs
// stand as parallel load paths. Both sets are in compression under the crane's own
// weight, which is what makes the reading a comparison of capacities at two
// lengths rather than of two different cranes. The reading is the static check at
// the run-start posture (specs/structure.md, "The static check").

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import { BUCKLE_REF, STRUT_CAP_COMPRESSION, STRUT_MAX_LEN } from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
} from "../harness";

/** The relative span a reported utilization is read against. */
const TOLERANCE = 1e-9;

const MEMBERS: readonly DesignMember[] = [
  // The four length-6 legs: anchor straight up to the ring's bottom flange.
  [[0, 0, 0], [0, 6, 0], "strut"],
  [[2, 0, 0], [2, 6, 0], "strut"],
  [[0, 0, 2], [0, 6, 2], "strut"],
  [[2, 0, 2], [2, 6, 2], "strut"],
  // The four length-4 legs, to the inner frame the long legs run past.
  [[0, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [0, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 2], "strut"],
  // The inner frame at y = 4, braced square and one diagonal.
  [[0, 4, 0], [2, 4, 0], "strut"],
  [[0, 4, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [0, 4, 2], "strut"],
  [[2, 4, 0], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 2], "strut"],
  [[0, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [2, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 0], "strut"],
  // The frame up to the bottom flange, braced square and one diagonal.
  [[0, 4, 0], [0, 6, 0], "strut"],
  [[2, 4, 0], [2, 6, 0], "strut"],
  [[0, 4, 2], [0, 6, 2], "strut"],
  [[2, 4, 2], [2, 6, 2], "strut"],
  [[0, 6, 0], [2, 6, 0], "strut"],
  [[0, 6, 2], [2, 6, 2], "strut"],
  [[0, 6, 0], [0, 6, 2], "strut"],
  [[2, 6, 0], [2, 6, 2], "strut"],
  [[0, 6, 0], [2, 6, 2], "strut"],
  [[0, 4, 0], [2, 6, 0], "strut"],
  [[0, 4, 2], [2, 6, 2], "strut"],
  [[2, 4, 2], [2, 6, 0], "strut"],
  // The jib on the top flange: a mast head, two rails, and their hangers.
  [[2, 8, 0], [2, 12, 0], "strut"],
  [[2, 12, 0], [2, 8, 2], "strut"],
  [[2, 12, 0], [0, 8, 2], "strut"],
  [[2, 12, 0], [0, 8, 0], "strut"],
  [[2, 8, 0], [4, 8, 0], "rail"],
  [[4, 8, 0], [6, 8, 0], "rail"],
  [[2, 12, 0], [4, 8, 0], "cable"],
  [[2, 12, 0], [6, 8, 0], "cable"],
  [[4, 8, 0], [2, 8, 2], "strut"],
  [[6, 8, 0], [2, 8, 2], "strut"],
];

/** A crane whose tower legs stand at two lengths, one of them `STRUT_MAX_LEN`. */
const LONG_LEG_CRANE: CraneDesign = {
  site: 1,
  name: "Long-leg tower",
  ring: [0, 6, 0],
  counterweights: [],
  members: MEMBERS,
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scores a compressed strut of length STRUT_MAX_LEN against its reduced capacity", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, LONG_LEG_CRANE);

  const { structure } = await h.snapshot();
  const result = await h.check();
  assertTrue(result.stable, "the long-leg tower stands, so the check solves it");

  const reduced = STRUT_CAP_COMPRESSION * (BUCKLE_REF / STRUT_MAX_LEN) ** 2;
  const byId = new Map(structure.members.map((m) => [m.id, m]));
  let scored = 0;
  for (const reading of result.members) {
    const member = byId.get(reading.id);
    if (member === undefined || member.material !== "strut") continue;
    const length = distance3(member.a, member.b);
    if (Math.abs(length - STRUT_MAX_LEN) > 1e-9 || reading.force >= 0) continue;
    scored += 1;
    assertNear(
      reading.utilization,
      -reading.force / reduced,
      Math.abs(reading.force / reduced) * TOLERANCE,
      `member ${reading.id}, a strut of length ${STRUT_MAX_LEN} carrying ` +
        `${reading.force.toFixed(4)} in compression, scored against ` +
        `${STRUT_CAP_COMPRESSION} * (${BUCKLE_REF} / ${STRUT_MAX_LEN})^2 = ` +
        `${reduced.toFixed(4)} (specs/structure.md)`,
    );
  }
  assertGreaterThan(
    scored,
    0,
    `struts of length ${STRUT_MAX_LEN} standing in compression, so the check ` +
      "has something to score",
  );

  await h.advance(1);
  await h.capture(
    "long-struts",
    "The long-leg tower, whose length-6 legs carry compression",
  );
});
