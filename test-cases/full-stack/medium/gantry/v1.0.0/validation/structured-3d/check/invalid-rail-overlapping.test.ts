// check/invalid-rail-overlapping — rails that share part of their run raise
// `invalid-rail`.
//
// specs/structure.md § The trolley and the rail, the second track rule: the
// rails "cover one unbroken stretch of it exactly once: no two rails overlap and
// no gap is left between them. They therefore meet end to end, each sharing an
// end node with the next, and a track of `n` rails runs over `n + 1` nodes".
// § Readiness: "`invalid-rail` — The crane has a ring and rail members, and they
// break one of the track rules above."
//
// The scenario is the mirror of the gap: two rails on one line whose spans
// share a stretch rather than leaving one bare. Both run along `y = 4, z = 0`,
// one from `x = 0` to `x = 4` and one from `x = 2` to `x = 6`, so the stretch
// from `x = 2` to `x = 4` is covered twice and the two rails run over four nodes
// instead of the three a two-rail track runs over. Nothing else is broken: both
// are horizontal, both are collinear, both are in the arm — the near rail starts
// at the top-flange node `(0, 4, 0)` and the far one starts at the top-flange
// node `(2, 4, 0)` — and the extreme nodes `x = 0` and `x = 6` stand at
// `sqrt(2)` and `sqrt(26)` from the slew axis through `(1, ·, 1)`.
//
// The two rails join different pairs of nodes, so the editor's duplicate rule
// (specs/structure.md § The editor's rules, "a member already joins the same two
// nodes") does not refuse the second: overlapping in space is not joining the
// same nodes, which is why this is a readiness rule at all.
//
// THE STRUCTURE IS THE RING AND THE TWO RAILS AND NOTHING ELSE. The issue is
// raised of a crane that "has a ring and rail members", so those are what the
// scenario stands; each rail ends at a flange node, so `disconnected-members` has
// nothing to say either. A tower under it would be surface this point does not
// decide, and every editor rule a tower can trip on belongs to another validator.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/** A ring, and two collinear rails covering the stretch from `x = 2` to `x = 4` twice. */
const OVERLAPPING_TRACK: CraneDesign = {
  site: 0,
  name: "Overlapping track",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[2, 4, 0], [6, 4, 0], "rail"],
  ],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises invalid-rail for two collinear rails whose spans overlap", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, OVERLAPPING_TRACK);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "two collinear rails sharing part of their run");

  assertContains(
    issues,
    "invalid-rail",
    "the issue overlapping rails raise (specs/structure.md § The trolley and " +
      "the rail)",
  );
});
