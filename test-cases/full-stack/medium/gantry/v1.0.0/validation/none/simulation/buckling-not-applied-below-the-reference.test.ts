// simulation/buckling-not-applied-below-the-reference — a strut shorter than
// BUCKLE_REF is held to its plain compression capacity.
//
// specs/structure.md states the reduction as a factor that is never above one:
// "a member of length `L` bears compression up to its compression capacity times
// `min(1, (BUCKLE_REF / L)^2)`, with `BUCKLE_REF` (`4`)". The `min` is the whole
// point of this check: below the reference the factor is `1`, so a short strut is
// utilized against `STRUT_CAP_COMPRESSION` exactly and never against the enlarged
// capacity `(BUCKLE_REF / L)^2` alone would give — a length-2 strut would
// otherwise report a quarter of the utilization it should, and a build that
// dropped the `min` would look four times as safe as it is.
//
// The scenario is the harness's own minimal crane, whose four legs and whose
// bottom-flange square are length-2 struts carrying the tower's weight in
// compression, read through the static check at the run-start posture
// (specs/structure.md, "The static check"). Nothing is added to the yard: the
// requirement is about how a force is scored, not about what applies it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, assertTrue } from "../assert";
import { BUCKLE_REF, RAIL_CAP_COMPRESSION, STRUT_CAP_COMPRESSION } from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The relative span a reported utilization is read against. */
const TOLERANCE = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("scores a compressed strut shorter than BUCKLE_REF against its plain capacity", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);

  const { structure } = await h.snapshot();
  const result = await h.check();
  assertTrue(result.stable, "the minimal crane stands, so the check solves it");

  const byId = new Map(structure.members.map((m) => [m.id, m]));
  let scored = 0;
  for (const reading of result.members) {
    const member = byId.get(reading.id);
    if (member === undefined || member.material === "cable") continue;
    const length = distance3(member.a, member.b);
    if (length >= BUCKLE_REF || reading.force >= 0) continue;
    const capacity =
      member.material === "rail" ? RAIL_CAP_COMPRESSION : STRUT_CAP_COMPRESSION;
    scored += 1;
    assertNear(
      reading.utilization,
      -reading.force / capacity,
      Math.abs(reading.force / capacity) * TOLERANCE,
      `member ${reading.id}, a ${member.material} of length ${length.toFixed(3)} ` +
        `carrying ${reading.force.toFixed(4)} in compression, scored against ` +
        `${capacity} rather than against ${capacity} * (${BUCKLE_REF} / ` +
        `${length.toFixed(3)})^2 (specs/structure.md)`,
    );
  }
  await h.advance(1);
  await h.capture(
    "short-struts",
    "The minimal crane, whose short struts carry compression",
  );

  assertGreaterThan(
    scored,
    0,
    `members shorter than BUCKLE_REF (${BUCKLE_REF}) standing in compression, ` +
      "so the check has something to score",
  );
});
