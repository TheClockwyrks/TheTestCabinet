// check/issue-no-rail — a crane with a ring and no rail members raises
// `no-rail`.
//
// specs/structure.md § Readiness: "`no-rail` — The crane has no rail members."
//
// THE SCENARIO IS THE SMALLEST CRANE THAT CAN RAISE IT: a slew ring, and one
// strut leaving its top flange for a free node. That is a crane with a ring and
// with members — so a build is genuinely reading a structure rather than an empty
// one — and not a rail among them. It breaks no other readiness rule: it has a
// ring, and its one member reaches a flange node, so neither `no-ring` nor
// `disconnected-members` can speak and the reading is about the missing rails and
// nothing else.
//
// NOTHING ELSE IS BUILT, and the tower this crane does not have is the point. A
// tower would put nine or thirteen more placements between the site opening and
// the reading, every one of them a way for this item to fail for a reason that
// belongs to `editor/`, and not one of them is anything `no-rail` is decided on.
//
// It is posed as the sequence of edits that builds it (`poseCrane`), so it passes
// the same placement rules a player builds under, and the yard is emptied first so
// nothing standing in it can refuse one of them.

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

/** A ring on site 1's lattice, and one arm strut leaving its top flange. */
const NO_RAIL: CraneDesign = {
  site: 0,
  name: "A ring and one arm member",
  ring: [0, 2, 0],
  counterweights: [],
  members: [[[0, 4, 0], [0, 8, 0], "strut"]],
  tape: [],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises no-rail for a ringed crane carrying no rail member", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, NO_RAIL);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "a ringed crane with no rail members");

  assertContains(
    issues,
    "no-rail",
    "the issue a crane with no rail members raises (specs/structure.md " +
      "§ Readiness)",
  );
});
