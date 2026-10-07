// check/issue-no-rail-alone-without-rails — a ringed crane with no rails raises
// `no-rail` and not `invalid-rail`.
//
// specs/structure.md § The trolley and the rail states this in as many words: "A
// crane that has a ring and no rail members raises `no-rail` alone, for the same
// reason from the other side: with no rails there is no track to judge, so no
// track rule is broken." § Readiness gives the two rows the sentence names:
// "`no-rail` — The crane has no rail members" and "`invalid-rail` — The crane
// has a ring and rail members, and they break one of the track rules above."
//
// THE SCENARIO IS A RING AND AN ARM MADE ENTIRELY OF STRUTS: a mast leaving the
// ring's top flange for `(0, 8, 0)`, and a jib running out from there to
// `(4, 8, 0)`. There IS an arm, so the crane is not a bare ring and a build that
// judged the track off the arm's members would have members to judge — and there
// is no rail anywhere, so it has no track. Nothing is disconnected: both members
// reach the top flange, one directly and one through the other.
//
// AND NOTHING BUT THE ARM IS BUILT. The tower a fuller crane would carry decides
// nothing here — the two track rules the absent rails would be judged against
// speak of the arm and the slew axis, and both stand already — so building one
// would only add placements this item could fail on for reasons belonging to
// `editor/`.
//
// It is posed as the sequence of edits that builds it (`poseCrane`), so it passes
// the same placement rules a player builds under, and the yard is emptied first so
// nothing standing in it can refuse one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertTrue } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/** A ring, an arm — and not one rail member anywhere. */
const RAILLESS: CraneDesign = {
  site: 0,
  name: "Railless",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[0, 8, 0], [4, 8, 0], "strut"],
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

it("raises no-rail without invalid-rail when there is no track to judge", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, RAILLESS);

  const { issues } = await h.check();

  await h.advance(1);
  await h.capture("state", "a ringed crane whose arm carries no rail member");

  assertContains(
    issues,
    "no-rail",
    "the issue a crane with no rail members raises (specs/structure.md " +
      "§ Readiness)",
  );
  assertTrue(
    !issues.includes("invalid-rail"),
    "invalid-rail absent, there being no track to judge and so no track rule " +
      "broken (specs/structure.md § The trolley and the rail)",
  );
});
