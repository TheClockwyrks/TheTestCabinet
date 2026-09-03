// sites/site-5-load-2 — Site 5's second load is the one the specification wrote.
//
// specs/sites.md § Site 5 — High Shelf gives the row
// `2 | crate | 40 | (8, 2, -5) yaw 0 | (-7, 2, 4) yaw 0`, and the file's preamble
// fixes how to read it: "each `From` and `To` below is a load's lift point,
// `(x, y, z)`, followed by its yaw in degrees". § The site table says `SITES`
// carries each site's loads "exactly as this file states them".
//
// EVERY FIGURE IN THE ROW IS ONE REQUIREMENT. The class fixes the box
// specs/world.md gives it, the mass is what the hoist and the statics carry, the
// `From` is where the tape has to reach to attach, and the `To` is the pad
// specs/rigging.md judges a release against. This is the site's second half —
// "a crate placed on the ground beside it" — so its `To` at `y 2` is a ground
// set-down rather than a lift onto the platform, and its `z` of `4` is what puts
// it clear of the platform's `z -2..2` footprint.
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
const INDEX = 1;

/** specs/sites.md § Site 5 — High Shelf, load row 2. */
const CLASS: LoadClass = "crate";
const MASS = 40;
const FROM: LoadPose = { x: 8, y: 2, z: -5, yaw: 0 };
const TO: LoadPose = { x: -7, y: 2, z: 4, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries Site 5's load 2 as the specification authored it", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 5's crate, and the ground pad it is wanted on");

  const { site } = await h.snapshot();
  const load = site.loads[INDEX];
  assertDefined(load, "Site 5's load 2 (specs/sites.md § Site 5 — High Shelf)");
  const where = "(specs/sites.md § Site 5 — High Shelf, load 2)";

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
