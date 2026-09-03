// check/issue-no-rail — a crane with a ring and no rail members raises
// `no-rail`.
//
// specs/structure.md § Readiness: "`no-rail` — The crane has no rail members."
//
// The scenario is the minimal crane with its track taken away: the braced tower,
// the ring on top of it, and the mast tied to all four top-flange nodes, but not
// the one `rail` member nor the three struts that held that rail's far end up.
// What is left is a crane that breaks no other readiness rule — it has a ring,
// and every member reaches an anchor or a flange node — so the reading is about
// the missing rails and nothing else.
//
// It is posed as the sequence of edits that builds it (`poseCrane`), so it
// passes the same placement rules a player builds under, and the yard is emptied
// first so nothing standing in it can refuse one of them.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains } from "../assert";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/** The far end of the minimal crane's track: the node its rail runs out to. */
const TRACK_TIP = [4, 4, 0] as const;

/** The minimal crane, less the rail and the three ties to the rail's far end. */
const NO_RAIL: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Minimal, with no track",
  members: MINIMAL_CRANE.members.filter(
    ([a, b]) =>
      !(a[0] === TRACK_TIP[0] && a[1] === TRACK_TIP[1] && a[2] === TRACK_TIP[2]) &&
      !(b[0] === TRACK_TIP[0] && b[1] === TRACK_TIP[1] && b[2] === TRACK_TIP[2]),
  ),
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
  await clearAll(h);
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
