// simulation/tower-on-nothing-is-singular — a crane no intact member joins to
// the bottom flange or an anchor does not stand.
//
// specs/statics.md § Singularity names this case in as many words: "A supported
// system that has unknowns and no stiffness anywhere has a largest diagonal of
// `0` and a first pivot of `0`, so it is singular: that is the tower solve of a
// crane no intact member joins to the bottom flange or to an anchor, which stands
// on nothing." The four bottom-flange nodes are unknowns whatever the tower holds
// — "A flange node belongs to its solve whether or not a member ends there, since
// it carries ring mass and, on the bottom flange, the force carried across" — so
// a crane with no tower member at all hands the tower solve four free nodes and
// no member to stiffen them.
//
// THE CRANE IS THE ARM OF THE HARNESS'S MINIMAL CRANE AND NOTHING ELSE: the ring
// at `(0, 2, 0)`, the mast tied to all four top-flange nodes, and the rail with
// the three ties that hold its far end. Every one of those is an arm member, so
// the arm solve is the regular one it is in the minimal crane and the singular
// verdict can only be the tower's. The crane still breaks no readiness rule —
// it has a ring, it has a rail, that rail is a valid track, and every member has
// a path to a flange node — so specs/structure.md § The static check solves it
// rather than refusing it, and `stable` is the solve's verdict alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertTrue } from "../assert";
import {
  MINIMAL_CRANE,
  createHarness,
  openSite,
  poseCrane,
  type CraneDesign,
  type Harness,
} from "../harness";

/** First Lift: the arm alone costs far under its budget. */
const SITE = 0;

/** The index in MINIMAL_CRANE at which the arm begins. */
const ARM_FROM = 13;

/** The minimal crane's ring and arm, with no tower member at all. */
const ARM_ONLY: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "The minimal crane's arm, standing on nothing",
  members: MINIMAL_CRANE.members.slice(ARM_FROM),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("does not stand a crane whose tower solve holds no member at all", async () => {
  await openSite(h, SITE);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await poseCrane(h, ARM_ONLY);

  const result = await h.check();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(
    result.issues.filter((issue) => issue !== "empty-program"),
    0,
    "the readiness issues of a crane that has a ring, a valid track and no " +
      "member joined to nothing (specs/structure.md § Readiness), so the " +
      "check reaches the solves",
  );
  assertTrue(
    !result.stable,
    "the verdict on a crane no intact member joins to the bottom flange or " +
      "to an anchor: its tower solve has unknowns and no stiffness anywhere, " +
      "so its first pivot is 0 and the system is singular " +
      "(specs/statics.md § Singularity)",
  );
});
