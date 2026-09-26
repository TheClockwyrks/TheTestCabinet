// instrumentation/add-load-target-starts-at-its-starting-pose — a posed load's
// target pose starts equal to its starting pose.
//
// `specs/instrumentation.md` § The site, of `addLoad`: "Its target pose starts
// equal to its starting pose." That is what makes the pad a second call: a
// scenario that wants a load set down somewhere else says so with `setLoadTarget`,
// and a scenario that wants a load ALREADY where it is wanted says nothing at all.
// A build that left the target at the origin, or at the site's authored pad, would
// hand every such scenario a different world from the one it asked for.
//
// One load on an emptied yard, and its target read straight after the call with
// nothing else touching it: `setLoadTarget` is never called here, so `to` is
// whatever `addLoad` alone left.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The pose the load is given, and therefore the pad it must start with. */
const POSE = { x: 8, y: 2, z: 0, yaw: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives an added load a target pose equal to its starting pose", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addLoad("crate", 40, POSE.x, POSE.y, POSE.z, POSE.yaw);

  const { site } = await h.snapshot();
  await h.capture(
    "state",
    "the load addLoad appended, standing on its own pad",
  );

  assertLength(site.loads, 1, "the load addLoad appends");
  assertDeepEqual(
    site.loads[0]?.from,
    POSE,
    "the starting pose the load was given",
  );
  assertDeepEqual(
    site.loads[0]?.to,
    POSE,
    "the target pose an added load starts with (specs/instrumentation.md)",
  );
});
