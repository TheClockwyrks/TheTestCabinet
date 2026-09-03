// sites/site-2-load-2 — Site 2's second load is the one the specification wrote.
//
// specs/sites.md § Site 2 — Turnabout gives the row
// `2 | crate | 60 | (0, 2, 9) yaw 0 | (0, 2, -7) yaw 0`, and the file's preamble
// fixes how to read it: "each `From` and `To` below is a load's lift point,
// `(x, y, z)`, followed by its yaw in degrees". § The site table says `SITES`
// carries each site's loads "exactly as this file states them".
//
// THE ROW IS READ WHERE THE SITE PUTS IT — index `1` of the site's load list —
// because the table's numbering is the order the file states, and the site's
// first row is the point next door. The two rows differ in mass and in axis, so
// reading each at its own index is what makes a swapped pair fail rather than
// pass twice.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, the yard
// untouched and nothing ticked. This is authored data, not a run outcome.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import {
  createHarness,
  openSite,
  type Harness,
  type LoadClass,
  type LoadPose,
} from "../harness";

const SITE = 1;
const INDEX = 1;

/** specs/sites.md § Site 2 — Turnabout, load row 2. */
const CLASS: LoadClass = "crate";
const MASS = 60;
const FROM: LoadPose = { x: 0, y: 2, z: 9, yaw: 0 };
const TO: LoadPose = { x: 0, y: 2, z: -7, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries Site 2's load 2 as the specification authored it", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 2's second load, and the pad it is wanted on");

  const { site } = await h.snapshot();
  const load = site.loads[INDEX];
  assertDefined(load, "Site 2's load 2 (specs/sites.md § Site 2 — Turnabout)");
  const where = "(specs/sites.md § Site 2 — Turnabout, load 2)";

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
