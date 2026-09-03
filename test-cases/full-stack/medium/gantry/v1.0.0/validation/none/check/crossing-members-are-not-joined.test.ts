// check/crossing-members-are-not-joined — two members that only cross in space
// are not joined there.
//
// specs/structure.md § Members: "Members connect only where they share an end
// node: two members whose segments cross in space are not joined there and pass
// through one another freely." § Readiness then judges belonging by joins alone —
// `disconnected-members` is raised when a member "has no member path to an anchor
// or to a flange node" — so a member that touches the crane only by crossing it
// reaches nothing, and the check must say so.
//
// THE CROSSING IS EXACT AND MID-SPAN OF BOTH. The minimal crane carries a strut
// from the mast `(0, 8, 0)` down to its rail tip `(4, 4, 0)`, whose midpoint is
// `(2, 6, 0)`. The added strut runs from `(2, 6, -2)` to `(2, 6, 2)`, through
// that same point at ITS midpoint. Neither of its ends is a node the crane uses,
// so the two segments genuinely intersect and share nothing.
//
// AND THE ISSUE IS ATTRIBUTED. The crossing member is removed and the check read
// again: with it gone the issue list is empty, so the entry the first reading
// carried came from the crossing member and not from something else the crane was
// already carrying.
//
// `empty-program` is read past rather than written away. It is the tape's issue
// and this point is the structure's, so the crane is left with no tape at all and
// the two readings are compared on the readiness issues alone
// (specs/structure.md § Readiness lists the four; specs/program.md owns the
// fifth). Writing a step to silence it would put the tape editor on the route to
// a scenario about how members join.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength, fail } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** The readiness issues of a reading: everything the tape's own issue is not. */
function readiness(issues: readonly string[]): string[] {
  return issues.filter((one) => one !== "empty-program");
}

/** The midpoint of the minimal crane's mast-to-tip strut. */
const CROSSING_POINT = { x: 2, y: 6, z: 0 } as const;

/** The added strut's two ends, straddling that point and used by nothing. */
const FROM = { x: 2, y: 6, z: -2 } as const;
const TO = { x: 2, y: 6, z: 2 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("calls a member that reaches the crane only by crossing it disconnected", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);

  assertLength(
    readiness((await h.check()).issues),
    0,
    "the readiness issues of the minimal crane, before the crossing member " +
      "is placed (specs/structure.md)",
  );

  const id = (await h.snapshot()).structure.nextMemberId;
  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  const placed = (await h.snapshot()).structure.members;
  if (!placed.some((member) => member.id === id)) {
    fail(
      `the strut from (${FROM.x}, ${FROM.y}, ${FROM.z}) to (${TO.x}, ` +
        `${TO.y}, ${TO.z}) to be accepted: it breaks no rule of ` +
        "specs/structure.md § The editor's rules",
      `the structure carries ${placed.length} members`,
    );
  }

  assertContains(
    readiness((await h.check()).issues),
    "disconnected-members",
    `the issues with a strut crossing the crane at (${CROSSING_POINT.x}, ` +
      `${CROSSING_POINT.y}, ${CROSSING_POINT.z}) and sharing an end node ` +
      "with nothing: a crossing is not a join, so it has no member path to " +
      "an anchor or to a flange node (specs/structure.md)",
  );

  await h.advance(1);
  await h.capture(
    "crossing-orphan",
    "the crossing member the check calls disconnected",
  );

  await h.debug.removeMember(id);
  assertLength(
    readiness((await h.check()).issues),
    0,
    "the readiness issues once the crossing member is removed, which is what " +
      "makes the entry above that member's",
  );
});
