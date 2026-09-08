// sites/site-3-obstacles — Site 3 stands the one wall it was authored with.
//
// specs/sites.md § Site 3 — Over the Wall gives the obstacle row
// `Wall | (5, 0, -6) | (1, 8, 12)`, under the headings `Min corner` and `Size` —
// an axis-aligned box stated as a minimum corner and a size per axis. § The site
// table says `SITES` carries each site's obstacles "exactly as this file states
// them".
//
// THE WALL IS THE SITE. Its prose reads "One crate whose path crosses the wall:
// the lift goes up, over, and down", and every figure in the row decides whether
// that is true: `x 5` puts it between the crate's start at `x 9` and its pad at
// `x -5`, the height of `8` is what the lift has to clear, and the depth of `12`
// spans the whole of the site's `z -8..8` reach around it. A wall of a different
// height or in a different place is a different puzzle, and — through
// specs/statics.md's `structure-struck-obstacle` and specs/structure.md's refusal
// of an edit that passes through one — a different set of legal cranes.
//
// EXACTLY ONE BOX, because a second obstacle nobody was told about fails runs of
// its own accord. So the count is read as well as the figures.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, the yard
// untouched and nothing ticked. This is authored data, not a run outcome.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLength } from "../assert";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

const SITE = 2;

/** specs/sites.md § Site 3 — Over the Wall, the obstacle row. */
const MIN: Vec3 = { x: 5, y: 0, z: -6 };
const SIZE: Vec3 = { x: 1, y: 8, z: 12 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands Site 3's wall at the corner and the size the specification gives", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 3's wall, standing across the yard");

  const { site } = await h.snapshot();
  const where = "(specs/sites.md § Site 3 — Over the Wall)";

  assertLength(site.obstacles, 1, `the obstacles Site 3 carries ${where}`);
  const wall = site.obstacles[0];
  assertDefined(wall, `Site 3's wall ${where}`);

  assertEqual(wall?.min.x, MIN.x, `the wall's minimum corner, x ${where}`);
  assertEqual(wall?.min.y, MIN.y, `the wall's minimum corner, y ${where}`);
  assertEqual(wall?.min.z, MIN.z, `the wall's minimum corner, z ${where}`);
  assertEqual(wall?.size.x, SIZE.x, `the wall's size along x ${where}`);
  assertEqual(wall?.size.y, SIZE.y, `the wall's size along y ${where}`);
  assertEqual(wall?.size.z, SIZE.z, `the wall's size along z ${where}`);
});
