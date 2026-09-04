// instrumentation/set-load-target-sets-the-pad — `setLoadTarget` sets the pad a load
// must be set down on.
//
// `specs/instrumentation.md` § The site: "`setLoadTarget(index, x, y, z, yaw)` —
// Sets the target pose of the load at `index`, which is the pad it must be set down
// on." The snapshot reports that pose as the load's `to`, and `specs/rigging.md`
// judges a release against it, so this one call is how every set-down scenario in
// the suite says where the load is wanted.
//
// THE STARTING POSE IS READ BACK TOO, because the two poses are one call apart: a
// build that wrote the target over the load's `from`, or that moved the load to its
// new pad, would leave a scenario lifting from somewhere it never posed. That is not
// a second requirement — it is what "sets the target pose" means, against the
// `addLoad` that had just set both.
//
// One load on an emptied yard, and a pad well away from it on all three axes and at
// a yaw of its own, so no coordinate could be read out of the starting pose by
// accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Where the load stands, and the pad it is then told to be set down on. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 } as const;
const PAD = { x: -7, y: 2, z: 4, yaw: 90 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the target pose of the load at that index, leaving where it starts", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.addLoad("crate", 40, FROM.x, FROM.y, FROM.z, FROM.yaw);

  await h.debug.setLoadTarget(0, PAD.x, PAD.y, PAD.z, PAD.yaw);

  const { site } = await h.snapshot();
  await h.capture("state", "the pad setLoadTarget marked out");

  assertLength(site.loads, 1, "the load the pad belongs to");
  assertDeepEqual(
    site.loads[0]?.to,
    PAD,
    "the target pose setLoadTarget sets (specs/instrumentation.md)",
  );
  assertDeepEqual(
    site.loads[0]?.from,
    FROM,
    "where the load still starts: setLoadTarget sets the pad, not the pose",
  );
});
