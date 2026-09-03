// sites/site-5-load-1 — Site 5's first load is the one the specification wrote.
//
// specs/sites.md § Site 5 — High Shelf gives the row
// `1 | container | 80 | (8, 2, 0) yaw 0 | (-7, 8, 0) yaw 90`, and the file's
// preamble fixes how to read it: "each `From` and `To` below is a load's lift
// point, `(x, y, z)`, followed by its yaw in degrees". § The site table says
// `SITES` carries each site's loads "exactly as this file states them".
//
// EVERY FIGURE IN THE ROW IS ONE REQUIREMENT. The class fixes the box
// specs/world.md gives it, the mass is what the hoist and the statics carry, the
// `From` is where the tape has to reach to attach, and the `To` is the pad
// specs/rigging.md judges a release against. This row is the site's own prose —
// "a container set down on top of the platform, turned a quarter as its target
// pose asks" — so its `To` height of `8` is what puts it on the platform rather
// than beside it, and its yaw of `90` is the quarter turn.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, the yard
// untouched and nothing ticked. That the yard holds this row and one other is a
// count point; this point reads the row.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import {
  createHarness,
  openSite,
  type Harness,
  type LoadClass,
  type LoadPose,
} from "../harness";

const SITE = 4;
const INDEX = 0;

/** specs/sites.md § Site 5 — High Shelf, load row 1. */
const CLASS: LoadClass = "container";
const MASS = 80;
const FROM: LoadPose = { x: 8, y: 2, z: 0, yaw: 0 };
const TO: LoadPose = { x: -7, y: 8, z: 0, yaw: 90 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries Site 5's load 1 as the specification authored it", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 5's container, and the shelf it is wanted on");

  const { site } = await h.snapshot();
  const load = site.loads[INDEX];
  assertDefined(load, "Site 5's load 1 (specs/sites.md § Site 5 — High Shelf)");
  const where = "(specs/sites.md § Site 5 — High Shelf, load 1)";

  assertEqual(load?.class, CLASS, `the load's class ${where}`);
  assertEqual(load?.mass, MASS, `the load's mass ${where}`);
  assertEqual(load?.from.x, FROM.x, `the lift point's x it starts at ${where}`);
  assertEqual(load?.from.y, FROM.y, `the lift point's y it starts at ${where}`);
  assertEqual(load?.from.z, FROM.z, `the lift point's z it starts at ${where}`);
  assertEqual(load?.from.yaw, FROM.yaw, `the yaw it starts at ${where}`);
  assertEqual(load?.to.x, TO.x, `the pad's x it is wanted on ${where}`);
  assertEqual(load?.to.y, TO.y, `the pad's y it is wanted on ${where}`);
  assertEqual(load?.to.z, TO.z, `the pad's z it is wanted on ${where}`);
  assertEqual(load?.to.yaw, TO.yaw, `the yaw it is wanted at ${where}`);
});
