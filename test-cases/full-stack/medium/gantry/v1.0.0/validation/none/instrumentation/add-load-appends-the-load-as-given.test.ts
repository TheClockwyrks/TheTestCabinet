// instrumentation/add-load-appends-the-load-as-given — `addLoad` appends a load of
// the class, mass and pose it was given.
//
// `specs/instrumentation.md` § The site: "`addLoad(cls, mass, x, y, z, yaw)` —
// Appends a load of class `"crate"`, `"container"`, or `"drum"`, of that mass,
// starting at rest with its lift point at `(x, y, z)` and that yaw." Three things
// are stated at once and they are one requirement: what the load IS, where it
// STARTS, and that it is APPENDED — added after the loads already standing rather
// than replacing them or landing anywhere else in the order.
//
// TWO LOADS, OF TWO CLASSES AND TWO MASSES, IN A KNOWN ORDER, so the reading says
// which entry is which: one load could be read out of a build that ignored the
// order, and two of the same class could be read out of one that ignored the
// arguments.
//
// The yard is emptied first, so the loads in the reading are exactly the two this
// check appended and their indices are the order it appended them in. The pose a
// load is given is its lift point, "the center of its top face" (`specs/world.md`),
// and no rule the site poses pass could refuse any of this: "posing them refuses
// nothing".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends each load with the class, mass and starting pose it was given", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addLoad("container", 90, 6, 2, -6, 0);
  await h.debug.addLoad("drum", 120, 7, 3, 0, 45);

  const { site } = await h.snapshot();
  await h.capture("state", "the two loads addLoad appended");

  assertLength(site.loads, 2, "the loads two addLoad calls append");

  const first = site.loads[0];
  assertEqual(first?.class, "container", "the first load's class");
  assertEqual(first?.mass, 90, "the first load's mass");
  assertDeepEqual(
    first?.from,
    { x: 6, y: 2, z: -6, yaw: 0 },
    "the first load's starting pose, its lift point and yaw as given",
  );

  const second = site.loads[1];
  assertEqual(second?.class, "drum", "the second load's class");
  assertEqual(second?.mass, 120, "the second load's mass");
  assertDeepEqual(
    second?.from,
    { x: 7, y: 3, z: 0, yaw: 45 },
    "the second load's starting pose: appended after the first, not before it",
  );
});
