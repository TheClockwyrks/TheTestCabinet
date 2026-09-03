// editor/member-crossing-does-not-join — a member whose segment crosses another's
// is not joined to it, so the crossing creates no arm-to-tower path.
//
// specs/structure.md: "Members connect only where they share an end node: two
// members whose segments cross in space are not joined there and pass through one
// another freely." The rule that reads a build's answer to that is the arm-to-
// tower refusal, which refuses a member when "adding it would create a PATH OF
// MEMBERS between a bottom-flange or anchor node and a top-flange node". A build
// that joined crossing members would find such a path here and refuse; a build
// that honours the rule places the member.
//
// THE SCENARIO IS THE SMALLEST ONE THAT MAKES A CROSSING DECIDE THE RULE. With the
// ring seated at `(0, 4, 0)` its bottom flange is the four nodes at `y = 4` over
// `x 0..2`, `z 0..2` and its top flange the same four at `y = 6`:
//
//   - `(0, 0, 0)`-`(0, 4, 0)` is the TOWER: an anchor node (specs/sites.md gives
//     site 1 the anchors `(0,0,0)`, `(2,0,0)`, `(0,0,2)`, `(2,0,2)`) up to a
//     bottom-flange node.
//   - `(0, 6, 0)`-`(-2, 4, 0)` and `(-2, 4, 0)`-`(-2, 2, 0)` are the ARM: a
//     top-flange node out to `(-2, 4, 0)` and down to `(-2, 2, 0)`. Neither of
//     those two nodes is a flange node — the flange square spans `x 0..2`,
//     `z 0..2` — so the arm reaches down the outside of the tower.
//   - The member under test, `(-2, 2, 0)`-`(2, 2, 0)`, runs from that arm node
//     THROUGH `(0, 2, 0)`, a point strictly inside the tower strut, and ends at
//     `(2, 2, 0)`, a node nothing else touches.
//
// If the crossing joined, the arm at `(-2, 2, 0)` would reach the tower strut and
// on to the anchor and the bottom flange, and the rule would refuse. It does not
// join, so the only nodes the new member shares with anything are its own two ends
// — one arm node and one free node — and no path to the tower exists.
//
// THE WORLD IS EMPTIED so nothing else can refuse: every node is a lattice node
// inside site 1's envelope (`x -8..12`, `y 0..16`, `z -8..12`), the new member is
// `4` long against `STRUT_MAX_LEN` (`6`), its ends are distinct and no member
// joins them already, no obstacle stands anywhere, and the whole crane costs about
// `428` against a budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The ring's base corner: bottom flange at y 4, top flange at y 6. */
const RING = { x: 0, y: 4, z: 0 };

/** The tower leg, anchor to bottom flange. */
const TOWER = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 4, z: 0 },
] as const;

/** The arm, a top-flange node out and down the outside of the tower. */
const ARM = [
  [
    { x: 0, y: 6, z: 0 },
    { x: -2, y: 4, z: 0 },
  ],
  [
    { x: -2, y: 4, z: 0 },
    { x: -2, y: 2, z: 0 },
  ],
] as const;

/** The crossing member: from the arm, through (0, 2, 0), to a free node. */
const CROSSING = [
  { x: -2, y: 2, z: 0 },
  { x: 2, y: 2, z: 0 },
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a member crossing another, because a crossing joins them nowhere", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addMember(
    TOWER[0].x,
    TOWER[0].y,
    TOWER[0].z,
    TOWER[1].x,
    TOWER[1].y,
    TOWER[1].z,
    "strut",
  );
  for (const [a, b] of ARM) {
    await h.debug.addMember(a.x, a.y, a.z, b.x, b.y, b.z, "strut");
  }
  // The scenario itself, read back: three members standing, the tower's one and
  // the arm's two, with the ring between them. A build that refused any of these
  // has not posed the world this point is about, and the count below would be
  // read against the wrong crane.
  assertLength(
    (await h.snapshot()).structure.members,
    3,
    "the tower leg and the two arm members this scenario is built from",
  );

  await h.debug.addMember(
    CROSSING[0].x,
    CROSSING[0].y,
    CROSSING[0].z,
    CROSSING[1].x,
    CROSSING[1].y,
    CROSSING[1].z,
    "strut",
  );

  await h.advance(1);
  await h.capture(
    "crossing",
    "The arm member crossing the tower leg without joining it",
  );

  assertLength(
    (await h.snapshot()).structure.members,
    4,
    "the members standing after an arm member was run through the tower leg " +
      "at (0, 2, 0): members connect only where they share an end node, so the " +
      "crossing makes no path from the arm to the tower (specs/structure.md)",
  );
});
