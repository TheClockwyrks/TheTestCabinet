// sites/site-5-envelope — Site 5's build envelope spans the ranges it was
// authored with.
//
// specs/sites.md § Site 5 — High Shelf gives the site's row
// `Envelope | x -12..12, y 0..18, z -8..8`, and § The site table says `SITES`
// carries each site's envelope "exactly as this file states them". The envelope
// is the volume specs/structure.md builds inside — "either end is outside the
// envelope" refuses a member — so a site reporting different bounds refuses
// members a conforming site accepts and accepts members it should refuse. High
// Shelf reaches further in `-x` than any site before it, which is the side its
// platform and both its pads stand on.
//
// THE READING IS THE SITE AS IT OPENS. An envelope is authored data rather than
// a run outcome: `openSite` and one snapshot, nothing built and nothing ticked.
// Whether an edit outside the envelope is refused is the editor's point; this
// one decides the six figures.
//
// The ranges are inclusive on both ends (`x -12..12`), which is exactly what
// `envelope.min` and `envelope.max` report, so the reading is six equalities on
// integers and carries no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

const SITE = 4;

/** specs/sites.md § Site 5 — High Shelf, the `Envelope` row. */
const MIN: Vec3 = { x: -12, y: 0, z: -8 };
const MAX: Vec3 = { x: 12, y: 18, z: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spans Site 5's authored build envelope on all three axes", async () => {
  await openSite(h, SITE);
  await h.advance(1);
  await h.capture("envelope", "Site 5's envelope drawn over the yard");

  const { site } = await h.snapshot();
  const where = "(specs/sites.md § Site 5 — High Shelf)";

  assertEqual(site.envelope.min.x, MIN.x, `the envelope's low x ${where}`);
  assertEqual(site.envelope.min.y, MIN.y, `the envelope's low y ${where}`);
  assertEqual(site.envelope.min.z, MIN.z, `the envelope's low z ${where}`);
  assertEqual(site.envelope.max.x, MAX.x, `the envelope's high x ${where}`);
  assertEqual(site.envelope.max.y, MAX.y, `the envelope's high y ${where}`);
  assertEqual(site.envelope.max.z, MAX.z, `the envelope's high z ${where}`);
});
