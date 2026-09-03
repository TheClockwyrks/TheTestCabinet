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
//
// NOTHING STANDS HERE BUT WHAT RAISES THOSE THREE. Readiness is decided from the
// structure alone and a structure with any readiness issue "is not solved"
// (specs/structure.md § The static check), so this crane needs no tower, no
// bracing and no member that holds anything up — and posing one would only add
// placement rules that belong to the editor's own points. What is posed is the
// ring, the spine that puts the far rail in the arm, the two gapped rails, and
// the adrift strut: five edits, each of them one of the three issues' reasons
// for being raised.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
  type StartIssue,
} from "../harness";

/**
 * A ringed crane whose whole arm is the gapped track, plus one member standing
 * on nothing.
 *
 * The ring silences `no-ring` and the rails silence `no-rail`, which is what
 * leaves `invalid-rail` the first issue the order can show. The spine runs from
 * the top-flange node `(0, 4, 2)` to `(4, 4, 0)` so that the far rail has a
 * member path to the top flange and is "in the arm" like the near one: with both
 * rails in the arm, the gap between them is the one track rule they break. The
 * track's two end nodes, `(0, 4, 0)` and `(6, 4, 0)`, stand at distinct
 * horizontal distances from the slew axis, so that rule is not broken too.
 */
const GAPPED: CraneDesign = {
  site: 0,
  name: "Gapped track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    // The spine, from a top-flange node, that puts the far rail in the arm.
    [[0, 4, 2], [4, 4, 0], "strut"],
    // Two collinear horizontal rails in the arm, with a gap between them.
    [[0, 4, 0], [2, 4, 0], "rail"],
    [[4, 4, 0], [6, 4, 0], "rail"],
    // A strut on a ground node site 1 does not anchor, joined to nothing.
    [[6, 0, 0], [6, 2, 0], "strut"],
  ],
  tape: [],
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
