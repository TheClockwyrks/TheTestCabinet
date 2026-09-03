// check/issues-in-fixed-order — the issues come in the order the specification
// lists them.
//
// specs/instrumentation.md § Readings: "`issues` carries each issue once, in the
// order `specs/structure.md` lists them: `no-ring`, `no-rail`, `invalid-rail`,
// `disconnected-members`, and then `empty-program` last." That order is a fact
// about the reading rather than about the structure, so the way to decide it is
// to pose a structure that raises several at once and read the list whole.
//
// THE STRUCTURE RAISES FOUR OF THE FIVE, and the fifth is excluded by the
// specification rather than by this scenario: `invalid-rail` "is not raised" on a
// crane with no ring, because "The last two rules speak of the arm and the slew
// axis, and a crane without a ring has neither" (specs/structure.md § The trolley
// and the rail). So no ring, no rail members, one member standing on an anchor
// and one standing on nothing, and an empty tape — `no-ring`, `no-rail`,
// `disconnected-members`, `empty-program`, in that order and each once.
//
// The anchored member is there so the disconnected one is disconnected on its own
// account rather than because the whole structure is adrift.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type StartIssue,
} from "../harness";

/** A strut standing on site 1's anchor `(0, 0, 0)`: part of the tower. */
const ANCHORED = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 2, z: 0 },
] as const;

/** A strut standing on `(6, 0, 0)`, which site 1 does not anchor. */
const ADRIFT = [
  { x: 6, y: 0, z: 0 },
  { x: 6, y: 2, z: 0 },
] as const;

/** The four the structure above raises, in the order the specification fixes. */
const EXPECTED: readonly StartIssue[] = [
  "no-ring",
  "no-rail",
  "disconnected-members",
  "empty-program",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no-ring, no-rail, disconnected-members and then empty-program", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  for (const [a, b] of [ANCHORED, ADRIFT]) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "strut");
  }
  assertLength(
    (await h.snapshot()).structure.members,
    2,
    "the two struts standing as the whole of the structure",
  );

  assertDeepEqual(
    (await h.check()).issues,
    EXPECTED,
    "the issues of a ringless, railless crane carrying an adrift member and " +
      "an empty tape, each once and in the order specs/structure.md lists " +
      "them (specs/instrumentation.md)",
  );

  await h.advance(1);
  await h.capture(
    "four-issues",
    "the four issues in the order the specification lists them",
  );
});
