// sites/site-4-load-1 — Site 4's load is the one the specification wrote.
//
// specs/sites.md § Site 4 — Long Reach gives the row
// `1 | container | 90 | (6, 2, -6) yaw 0 | (14, 2, 6) yaw 90`, and the file's
// preamble fixes how to read it: "each `From` and `To` below is a load's lift
// point, `(x, y, z)`, followed by its yaw in degrees". § The site table says
// `SITES` carries each site's loads "exactly as this file states them".
//
// THE YAW OF `90` IS PART OF THE ROW, not decoration. The site's prose reads "A
// heavy container delivered far from the anchors, turned a quarter on the way",
// and specs/rigging.md judges a set-down against the target yaw within
// `PLACE_YAW_TOL`, so a build that authored the pad at yaw `0` has removed the
// quarter turn the site is about — and it is the only site of the four here whose
// target yaw is not `0`.
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

const SITE = 3;
const INDEX = 0;

/** specs/sites.md § Site 4 — Long Reach, load row 1. */
const CLASS: LoadClass = "container";
const MASS = 90;
const FROM: LoadPose = { x: 6, y: 2, z: -6, yaw: 0 };
const TO: LoadPose = { x: 14, y: 2, z: 6, yaw: 90 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries Site 4's load 1 as the specification authored it", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 4's container, and the pad it is turned onto");

  const { site } = await h.snapshot();
  const load = site.loads[INDEX];
  assertDefined(load, "Site 4's load 1 (specs/sites.md § Site 4 — Long Reach)");
  const where = "(specs/sites.md § Site 4 — Long Reach, load 1)";

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
