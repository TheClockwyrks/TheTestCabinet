// sites/site-2-envelope — Site 2's build envelope spans the ranges it was
// authored with.
//
// specs/sites.md § Site 2 — Turnabout gives the site's row
// `Envelope | x -10..12, y 0..16, z -10..12`, and § The site table says `SITES`
// carries each site's envelope "exactly as this file states them". The envelope
// is the volume specs/structure.md builds inside, so a site reporting different
// bounds refuses members a conforming site accepts and accepts members it should
// refuse. On this site the negative reach is the whole puzzle — both loads are
// carried "straight across the yard" to `x -7` and `z -7` — so the low bounds of
// `-10` are what a conforming crane needs to reach over.
//
// THE READING IS THE SITE AS IT OPENS. An envelope is authored data rather than
// a run outcome: `openSite` and one snapshot, nothing built and nothing ticked.
// Whether an edit outside the envelope is refused is the editor's point; this one
// decides the six figures.
//
// The ranges are inclusive on both ends (`x -10..12`), which is exactly what
// `envelope.min` and `envelope.max` report, so the reading is six equalities on
// integers and carries no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

const SITE = 1;

/** specs/sites.md § Site 2 — Turnabout, the `Envelope` row. */
const MIN: Vec3 = { x: -10, y: 0, z: -10 };
const MAX: Vec3 = { x: 12, y: 16, z: 12 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spans Site 2's authored build envelope on all three axes", async () => {
  await openSite(h, SITE);
  await h.capture("envelope", "Site 2's envelope drawn over the yard");

  const { site } = await h.snapshot();
  const where = "(specs/sites.md § Site 2 — Turnabout)";

  assertEqual(site.envelope.min.x, MIN.x, `the envelope's low x ${where}`);
  assertEqual(site.envelope.min.y, MIN.y, `the envelope's low y ${where}`);
  assertEqual(site.envelope.min.z, MIN.z, `the envelope's low z ${where}`);
  assertEqual(site.envelope.max.x, MAX.x, `the envelope's high x ${where}`);
  assertEqual(site.envelope.max.y, MAX.y, `the envelope's high y ${where}`);
  assertEqual(site.envelope.max.z, MAX.z, `the envelope's high z ${where}`);
});
