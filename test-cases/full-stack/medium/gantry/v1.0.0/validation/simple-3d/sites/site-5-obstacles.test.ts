// sites/site-5-obstacles — Site 5 stands the one platform it was authored with.
//
// specs/sites.md § Site 5 — High Shelf gives the obstacle row
// `Platform | (-9, 0, -2) | (4, 6, 4)`, under the headings `Min corner` and
// `Size` — an axis-aligned box stated as a minimum corner and a size per axis.
// § The site table says `SITES` carries each site's obstacles "exactly as this
// file states them".
//
// THE PLATFORM IS THE SHELF. Its prose reads "a container set down on top of the
// platform", and every figure in the row decides whether that is possible: the
// corner at `x -9` with a size of `4` spans `x -9..-5`, and `z -2..2`, which is
// the footprint the load 1 pad at `(-7, 8, 0)` sits over; the height of `6` is
// what the container has to be lifted above. A platform of a different height or
// in a different place is a different puzzle, and — through specs/statics.md's
// `structure-struck-obstacle` and specs/structure.md's refusal of an edit that
// passes through one — a different set of legal cranes.
//
// EXACTLY ONE BOX, because a second obstacle nobody was told about fails runs of
// its own accord. So the count is read as well as the figures.
//
// THE READING IS THE SITE AS IT OPENS: `openSite` and one snapshot, the yard
// untouched and nothing ticked. This is authored data, not a run outcome, so
// `emptyYard` would clear the very list the point reads.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLength } from "../assert";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

const SITE = 4;

/** specs/sites.md § Site 5 — High Shelf, the obstacle row. */
const MIN: Vec3 = { x: -9, y: 0, z: -2 };
const SIZE: Vec3 = { x: 4, y: 6, z: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stands Site 5's platform at the corner and the size the specification gives", async () => {
  await openSite(h, SITE);
  await h.capture("state", "Site 5's platform, standing in the yard");

  const { site } = await h.snapshot();
  const where = "(specs/sites.md § Site 5 — High Shelf)";

  assertLength(site.obstacles, 1, `the obstacles Site 5 carries ${where}`);
  const platform = site.obstacles[0];
  assertDefined(platform, `Site 5's platform ${where}`);

  assertEqual(
    platform?.min.x,
    MIN.x,
    `the platform's minimum corner, x ${where}`,
  );
  assertEqual(
    platform?.min.y,
    MIN.y,
    `the platform's minimum corner, y ${where}`,
  );
  assertEqual(
    platform?.min.z,
    MIN.z,
    `the platform's minimum corner, z ${where}`,
  );
  assertEqual(
    platform?.size.x,
    SIZE.x,
    `the platform's size along x ${where}`,
  );
  assertEqual(
    platform?.size.y,
    SIZE.y,
    `the platform's size along y ${where}`,
  );
  assertEqual(
    platform?.size.z,
    SIZE.z,
    `the platform's size along z ${where}`,
  );
});
