// sites/site-6-load-2 — Site 6's second load is the one the specification wrote.
//
// specs/sites.md § Site 6 — Heavy Haul gives the row
// `2 | crate | 30 | (14, 2, 4) yaw 0 | (-4, 2, -6) yaw 0`, and the file's
// preamble fixes how to read it: "each `From` and `To` below is a load's lift
// point, `(x, y, z)`, followed by its yaw in degrees". § The site table says
// `SITES` carries each site's loads "exactly as this file states them".
//
// EVERY FIGURE IN THE ROW IS ONE REQUIREMENT. The class fixes the box
// specs/world.md gives it, the mass is what the hoist and the statics carry, the
// `From` is where the tape has to reach to attach, and the `To` is the pad
// specs/rigging.md judges a release against. This is the site's second half —
// "a light crate far down the yard, from one crane" — so its `From` at `x 14` is
// what the same crane that lifts the drum has to reach out to, and its pad across
// the yard at `(-4, 2, -6)` is the swing back.
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

const SITE = 5;
const INDEX = 1;

/** specs/sites.md § Site 6 — Heavy Haul, load row 2. */
const CLASS: LoadClass = "crate";
const MASS = 30;
const FROM: LoadPose = { x: 14, y: 2, z: 4, yaw: 0 };
const TO: LoadPose = { x: -4, y: 2, z: -6, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries Site 6's load 2 as the specification authored it", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 6's crate, and the pad it is wanted on");

  const { site } = await h.snapshot();
  const load = site.loads[INDEX];
  assertDefined(load, "Site 6's load 2 (specs/sites.md § Site 6 — Heavy Haul)");
  const where = "(specs/sites.md § Site 6 — Heavy Haul, load 2)";

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
