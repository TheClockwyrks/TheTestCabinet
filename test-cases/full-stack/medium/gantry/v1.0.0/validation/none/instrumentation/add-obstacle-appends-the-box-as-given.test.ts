// instrumentation/add-obstacle-appends-the-box-as-given — `addObstacle` appends the
// box it was given.
//
// `specs/instrumentation.md` § The site: "`addObstacle(x, y, z, w, h, d)` —
// Appends an obstacle: the axis-aligned box with minimum corner `(x, y, z)` and
// size `(w, h, d)`", and the snapshot reports the site's obstacles as
// `{ min, size }` in that order. `specs/world.md` fixes the same reading of the two
// triples — "An obstacle is a fixed axis-aligned box, stated as a minimum corner
// and a size per axis" — so a build that read the six numbers as two corners, or as
// a center and a half-size, puts its boxes somewhere else entirely and every
// obstacle scenario in the suite would be posing a world it did not describe.
//
// TWO BOXES OF DIFFERENT SIZES, IN A KNOWN ORDER, so the reading says which is
// which and neither is square enough to hide an axis swap: the first is thin on
// `x` and long on `z`, the second is taller than it is wide.
//
// The yard is emptied first, so the obstacles in the reading are exactly the two
// this check appended, and nothing refuses them: "posing them refuses nothing and
// changes nothing that is built".

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("appends each obstacle with the minimum corner and size it was given", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addObstacle(5, 0, -6, 1, 8, 12);
  await h.debug.addObstacle(-9, 0, -2, 4, 6, 4);

  const { site } = await h.snapshot();
  await h.capture("state", "the two obstacles addObstacle appended");

  assertLength(site.obstacles, 2, "the obstacles two addObstacle calls append");
  assertDeepEqual(
    site.obstacles[0],
    { min: { x: 5, y: 0, z: -6 }, size: { x: 1, y: 8, z: 12 } },
    "the first obstacle: its minimum corner and its per-axis size as given",
  );
  assertDeepEqual(
    site.obstacles[1],
    { min: { x: -9, y: 0, z: -2 }, size: { x: 4, y: 6, z: 4 } },
    "the second obstacle, appended after the first",
  );
});
