// simulation/utilization-compression — a member in compression is utilized
// against its compression capacity, buckling-reduced by its length.
//
// specs/statics.md § Utilization and breakage states the readout exactly:
//
//     utilization = N / capacityTension          when N >= 0
//     utilization = -N / capacityCompression(L)  when N < 0
//
// "with the compression capacity length-reduced as `specs/structure.md` states",
// and that file states the reduction: "a member of length `L` bears compression
// up to its compression capacity times `min(1, (BUCKLE_REF / L)^2)`, with
// `BUCKLE_REF` (`4`)". A strut and a rail both carry `2400`.
//
// THE SCENARIO IS THE STATIC CHECK OF THE HARNESS'S MINIMAL CRANE, because that
// crane holds struts at four different lengths and hangs several of them in
// compression under nothing but its own weight and the bare hook: the four legs
// at `2` and the bottom-flange members at `2` and `2.83` (reduction `1`, since
// `L` is under `BUCKLE_REF`), the mast ties at `4`, `4.47` and `4.9` (reductions
// `1`, `0.8` and `0.667`), and the rail-tip ties at `4.47` and `5.66` (`0.8` and
// `0.5`). So the reading separates the reduced capacity from the unreduced one
// and from the tension capacity, which for a strut and a rail are the same `2400`
// and would agree with an unreduced reading on the short members alone.
//
// The check is read rather than a run, because `specs/structure.md` has the check
// report "each intact member's force and utilization" at the run-start posture
// with nothing moving, which is the quietest world this reading can be taken in:
// no tape, no load, no obstacle, no motion.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import {
  BUCKLE_REF,
  RAIL_CAP_COMPRESSION,
  STRUT_CAP_COMPRESSION,
} from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/** Forces are thousands of units; the formula is exact, so this is arithmetic. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("utilizes a compressed member against its buckling-reduced compression capacity", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);

  const result = await h.check();
  const { structure } = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "check-members-force-utilization-structure-me",
    "check.members[].force/.utilization, structure.members[].a/.b/.material",
  );

  assertTrue(
    result.stable,
    "the minimal crane to stand, so the check reports every member's force " +
      "and utilization (specs/structure.md § The static check)",
  );

  let compressed = 0;
  for (const reading of result.members) {
    if (reading.force >= 0) continue;
    const member = structure.members.find((one) => one.id === reading.id);
    assertTrue(
      member !== undefined,
      `the structure to carry the member the check reports as ${reading.id}`,
    );
    if (member === undefined) continue;
    const length = distance3(member.a, member.b);
    const capacity =
      member.material === "rail" ? RAIL_CAP_COMPRESSION : STRUT_CAP_COMPRESSION;
    const reduction = Math.min(1, (BUCKLE_REF / length) ** 2);
    compressed += 1;
    assertNear(
      reading.utilization,
      -reading.force / (capacity * reduction),
      TOLERANCE,
      `the utilization of member ${reading.id}, a ${member.material} of ` +
        `length ${length.toFixed(3)} carrying ${reading.force.toFixed(3)} in ` +
        `compression: -N / (${capacity} * min(1, (${BUCKLE_REF} / L)^2)) ` +
        "(specs/statics.md § Utilization and breakage)",
    );
  }

  assertGreaterThan(
    compressed,
    0,
    "the members the minimal crane hangs in compression under its own weight",
  );
});
