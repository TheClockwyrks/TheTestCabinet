// editor/ring-refused-joining-arm-to-tower — a ring that would leave the arm
// joined to the tower is refused.
//
// specs/structure.md: "A ring placement is refused when ... it would join the arm
// to the tower anywhere but through the ring: with the ring in place, some path of
// members would run between a bottom-flange or anchor node and a top-flange node."
// The ring is what divides a crane in two — "Force crosses between the flanges
// corner by corner, and that is the only path between the arm and the tower" — so
// a ring dropped onto a structure that already bridges its two flange squares
// would make a crane whose arm cannot turn, and the editor refuses it rather than
// leaving one on screen.
//
// THE SCENARIO IS THE SMALLEST STRUCTURE THAT BRIDGES. The world is emptied and a
// straight column of struts is raised from the anchor `(0, 0, 0)` through
// `(0, 2, 0)` and `(0, 4, 0)` to `(0, 6, 0)`, each two units long. The ring is then
// placed by the base corner `(0, 4, 0)`: its bottom flange square lies at `y 4` and
// its top flange square at `y 6`, so the column's last member runs directly from
// the bottom-flange node `(0, 4, 0)` to the top-flange node `(0, 6, 0)` — a path of
// members between the two, and the anchor at the foot of the column makes it one
// from an anchor as well. Every other ring rule is satisfied: the crane has no
// ring, all eight flange nodes lie inside site 1's envelope, the corner's `y` is
// not `0`, and `300` on top of the column's `60` is far inside the budget of
// `3000`. So the join is the only thing that can decide the placement.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNull } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The base corner: bottom flange at `y 4`, top flange at `y 6`. */
const CORNER = { x: 0, y: 4, z: 0 };

/** The column the ring would be dropped onto, anchor upward. */
const COLUMN: readonly (readonly [number, number])[] = [
  [0, 2],
  [2, 4],
  [4, 6],
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a ring whose flanges a standing column already joins", async () => {
  await openSite(h, 0);
  await clearAll(h);
  for (const [from, to] of COLUMN) {
    await h.debug.addMember(0, from, 0, 0, to, 0, "strut");
  }
  assertLength(
    (await h.snapshot()).structure.members,
    COLUMN.length,
    "the column this check drops the ring onto",
  );

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);

  await h.advance(1);
  await h.capture(
    "refused",
    "The bridged column after the ring placement was refused",
  );

  assertNull(
    (await h.snapshot()).structure.ring,
    "the ring after a placement that would leave a path of members between a " +
      "bottom-flange node and a top-flange node (specs/structure.md)",
  );
});
