// check/issues-carries-each-issue-once — an issue several members raise is
// reported once.
//
// specs/instrumentation.md § Readings: "`issues` carries each issue once, in the
// order `specs/structure.md` lists them". specs/structure.md § Readiness gives
// `disconnected-members` as a fact about the structure — "Some member belongs to
// neither the tower nor the arm" — rather than a list of the members that are
// adrift, so three adrift members are one entry and not three.
//
// THREE MEMBERS, EACH ADRIFT ON ITS OWN. Three struts stand on three ground nodes
// site 1 does not anchor, `(6, 0, 0)`, `(8, 0, 0)` and `(10, 0, 0)`, each rising
// to the node above it. No two of them share a node, so each is its own
// component and each raises the issue independently — which is what makes a
// count of one meaningful rather than an accident of them being one piece.
//
// The crane under them is the minimal one with a tape, so it raises nothing of
// its own and the reading is exactly the one entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  type Harness,
  type StartIssue,
} from "../harness";

/** Three ground nodes site 1 does not anchor, each with its own strut. */
const ADRIFT = [6, 8, 10] as const;

/** One entry, whatever the number of members raising it. */
const EXPECTED: readonly StartIssue[] = ["disconnected-members"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports one disconnected-members entry for three separately adrift members", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
      ],
    },
  ]);

  const built = (await h.snapshot()).structure.members.length;
  for (const x of ADRIFT) {
    await h.debug.addMember(x, 0, 0, x, 2, 0, "strut");
  }
  assertLength(
    (await h.snapshot()).structure.members,
    built + ADRIFT.length,
    "the three adrift struts standing beside the crane",
  );

  const checked = await h.check();

  await h.advance(1);
  await h.capture(
    "one-entry",
    "one disconnected-members entry for three adrift members",
  );

  assertDeepEqual(
    checked.issues,
    EXPECTED,
    "the issues with three separately adrift members: one entry, not three " +
      "(specs/instrumentation.md)",
  );
});
