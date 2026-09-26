// check/check-removes-no-member — a check breaks nothing.
//
// specs/structure.md § The static check: "Nothing breaks and nothing fails during
// a check: a utilization above `1` is reported and no more." A run is where
// breakage lives — specs/statics.md § Utilization and breakage removes "every
// member whose utilization exceeds `1`" after both solves — and the check must
// not do that work.
//
// SO THE CRANE HAS TO BE ONE A RUN WOULD BREAK. It is the harness's minimal crane
// with a counterweight on each of the fourteen nodes it uses, which loads the
// tower's four two-unit legs past `STRUT_CAP_COMPRESSION` (`2400`); the same
// crane check/check-reports-a-utilization-above-one reads a utilization above `1`
// off. If a check broke anything it would break here.
//
// The check is read three times over, because a check that removed a member would
// most plainly show as a second reading disagreeing with the first — and because
// a check is a reading "computed on the spot" from the structure as it stands
// (specs/instrumentation.md § Readings), the three readings are comparable
// exactly.
// `snapshot().structure.members` is read on both sides of them, so a member that
// went is caught whether or not the later readings still mention it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves an over-utilized crane whole, reading the same figures each time", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, LADEN);

  const before = JSON.stringify((await h.snapshot()).structure.members);

  const first = await h.check();
  const second = await h.check();
  const third = await h.check();

  const after = JSON.stringify((await h.snapshot()).structure.members);
  await h.advance(1);
  await h.capture(
    "structure-members-before-and-after-the-three-me",
    "structure.members before and after, the three member lists.",
  );

  assertEqual(
    after,
    before,
    "the members the crane holds across three checks, none of which breaks " +
      "anything (specs/structure.md § The static check)",
  );
  assertEqual(
    JSON.stringify(second.members),
    JSON.stringify(first.members),
    "the second check's forces and utilizations, against the first's " +
      "(specs/structure.md § The static check)",
  );
  assertEqual(
    JSON.stringify(third.members),
    JSON.stringify(first.members),
    "the third check's forces and utilizations, against the first's " +
      "(specs/structure.md § The static check)",
  );
});
