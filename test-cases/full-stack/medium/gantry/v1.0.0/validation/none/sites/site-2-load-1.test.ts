// sites/site-2-load-1 — Site 2's first load is the one the specification wrote.
//
// specs/sites.md § Site 2 — Turnabout gives the row
// `1 | crate | 40 | (9, 2, 0) yaw 0 | (-7, 2, 0) yaw 0`, and the file's preamble
// fixes how to read it: "each `From` and `To` below is a load's lift point,
// `(x, y, z)`, followed by its yaw in degrees". § The site table says `SITES`
// carries each site's loads "exactly as this file states them".
//
// THE ROW IS READ WHERE THE SITE PUTS IT — index `0` of the site's load list —
// because the table's numbering is the order the file states, and the site's
// second row is the point next door. A build that swapped the two would have to
// fail one of the two points, which is why each row is read at its own index.
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
const INDEX = 0;

/** specs/sites.md § Site 2 — Turnabout, load row 1. */
const CLASS: LoadClass = "crate";
const MASS = 40;
const FROM: LoadPose = { x: 9, y: 2, z: 0, yaw: 0 };
const TO: LoadPose = { x: -7, y: 2, z: 0, yaw: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries Site 2's load 1 as the specification authored it", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 2's first load, and the pad it is wanted on");

  const { site } = await h.snapshot();
  const load = site.loads[INDEX];
  assertDefined(load, "Site 2's load 1 (specs/sites.md § Site 2 — Turnabout)");
  const where = "(specs/sites.md § Site 2 — Turnabout, load 1)";

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
