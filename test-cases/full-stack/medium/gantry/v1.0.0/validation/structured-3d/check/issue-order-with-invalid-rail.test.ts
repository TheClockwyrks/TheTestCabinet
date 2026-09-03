// check/issue-order-with-invalid-rail — `invalid-rail` is reported before
// `disconnected-members` and `empty-program`.
//
// specs/instrumentation.md § Readings fixes the order: "`no-ring`, `no-rail`,
// `invalid-rail`, `disconnected-members`, and then `empty-program` last."
// `invalid-rail` is the one place in that order this crane can show it: it is
// raised only when "The crane has a ring and rail members, and they break one of
// the track rules" (specs/structure.md § Readiness), so a scenario that raises it
// necessarily silences `no-ring` and `no-rail` and can only be read against the
// two issues that follow it.
//
// THE TRACK RULE BROKEN IS THE UNBROKEN-STRETCH ONE. specs/structure.md § The
// trolley and the rail: rail members "cover one unbroken stretch of it exactly
// once: no two rails overlap and no gap is left between them". This crane's two
// rails run along the line `y = 4`, `z = 0` — the first from `x` `0` to `2`, the
// second from `4` to `6` — so they are horizontal and collinear, both in the arm,
// and separated by a gap of `2`.
//
// A strut standing on `(6, 0, 0)`, a ground node site 1 does not anchor, raises
// `disconnected-members`; the tape is left empty for `empty-program`. So the
// reading is exactly the three, in that order.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type StartIssue,
} from "../harness";

/**
 * The minimal crane, its one rail demoted to a strut so the track is the two
 * gapped rails below and nothing else, plus a member standing on nothing.
 *
 * Demoting rather than removing keeps the crane the braced, ready one the
 * minimal design is: what this reading is about is the track and the adrift
 * member, so nothing else about the structure is allowed to raise an issue.
 */
const GAPPED: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Gapped track",
  members: [
    ...MINIMAL_CRANE.members.map(
      (member): DesignMember =>
        member[2] === "rail" ? [member[0], member[1], "strut"] : member,
    ),
    // Two collinear horizontal rails in the arm, with a gap between them.
    [[0, 4, 0], [2, 4, 0], "rail"],
    [[4, 4, 0], [6, 4, 0], "rail"],
    // A strut on a ground node site 1 does not anchor, joined to nothing.
    [[6, 0, 0], [6, 2, 0], "strut"],
  ],
};

/** The three the crane above raises, in the order the specification fixes. */
const EXPECTED: readonly StartIssue[] = [
  "invalid-rail",
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

it("reports invalid-rail, then disconnected-members, then empty-program", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, GAPPED);

  assertDeepEqual(
    (await h.check()).issues,
    EXPECTED,
    "the issues of a ringed crane whose two rails leave a gap, carrying an " +
      "adrift member and an empty tape, in the order specs/structure.md " +
      "lists them (specs/instrumentation.md)",
  );

  await h.advance(1);
  await h.capture(
    "three-issues",
    "invalid-rail ahead of disconnected-members and empty-program",
  );
});
