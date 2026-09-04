// check/check-stands-for-a-sound-crane — a sound crane reports that the
// structure stands.
//
// specs/structure.md § The static check: "With any readiness issue the structure
// is not solved. Otherwise the two solves of `specs/statics.md` run at the
// run-start posture ... and the structure stands when both solves are regular."
// `stable` is the check's word for that verdict (specs/instrumentation.md:
// "`stable` is whether the structure stands").
//
// THE CRANE IS THE HARNESS'S MINIMAL ONE, and it is shaped for exactly this: a
// cube tower on the site's four anchors with a diagonal on each of its four
// sides and one across its top, the ring on that tower, a mast tied to all four
// top-flange nodes, and a rail tip tied out of its own plane. That is a fully
// braced 3D truss in both horizontal axes, so neither solve is the mechanism
// specs/statics.md § Singularity describes and both come back regular.
//
// The yard is emptied first: a load or an obstacle is nothing the static check
// reads (the check carries the bare hook alone), and an isolated world is what
// keeps this reading about the structure.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  standMinimalCrane,
  type Harness,
} from "../harness";

/** First Lift: the smallest envelope and budget the minimal crane fits. */
const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports stable for a fully braced ready crane", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);

  const result = await h.check();
  await h.advance(1);
  await h.capture("stable-members-length", "stable, members length.");

  assertTrue(
    result.stable,
    "the check's verdict on a fully braced ready crane, whose arm and tower " +
      "solves are both regular (specs/structure.md § The static check)",
  );
});
