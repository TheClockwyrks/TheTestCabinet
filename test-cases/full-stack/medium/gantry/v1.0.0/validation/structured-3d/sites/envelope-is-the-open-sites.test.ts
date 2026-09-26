// sites/envelope-is-the-open-sites — the envelope an edit is held to is the open
// site's, not one envelope for the whole game.
//
// specs/world.md § The envelope: "Each site fixes a build envelope: an
// axis-aligned box, stated as inclusive coordinate ranges on each axis. Every
// lattice node used by the structure lies inside the envelope", and
// specs/structure.md refuses a member placement when "either end is outside the
// envelope". specs/sites.md gives Site 4 — Long Reach `x -10..20` and Site 3 —
// Over the Wall `x -10..12`, so the node `(20, 0, 0)` is inside the one and
// outside the other, and § The site table has `SITES` carry all six envelopes
// "exactly as this file states them".
//
// THIS IS THE POINT A SINGLE HARD-CODED ENVELOPE FAILS, and nothing else
// catches: a build that bounded every site by the widest of the six, or by the
// first site's, reports six correct envelopes and still accepts the member below
// on Site 3. So the requirement is decided the only way it can be — by making
// the SAME edit on two sites and reading which one takes it.
//
// THE EDIT IS THE SMALLEST ONE THAT SEPARATES THEM. One strut, `(18, 0, 0)` to
// `(20, 0, 0)`: two units long, inside `STRUT_MAX_LEN`; twenty units of cost,
// inside both budgets; on the ground, inside both `y` ranges; at `z` `0`, inside
// both `z` ranges. Its far end sits exactly on Long Reach's inclusive upper
// bound of `x` `20`. So the envelope is the only rule that can decide it, and on
// Site 3 it is the rule that does.
//
// THE WORLD IS EMPTIED FIRST on both sites. Site 3 carries a wall, and
// specs/structure.md also refuses "its segment reaches inside an obstacle": a
// scenario that left the wall standing would be deciding this point against a
// site with two rules in play. `clearAll` leaves an empty yard, an empty
// structure and an empty tape, so what refuses the strut on Site 3 is the
// envelope alone.
//
// A REFUSAL IS SILENT (specs/structure.md: "a refused edit changes nothing"), so
// the reading on Site 3 is the absence of the member AND the cost still at zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import { STRUT_COST_PER_UNIT } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** Long Reach, `x -10..20`: the site the strut's far end is inside. */
const WIDE_SITE = 3;

/** Over the Wall, `x -10..12`: the site the same far end is outside. */
const NARROW_SITE = 2;

/** The one strut, whose far end is Long Reach's inclusive upper bound on x. */
const A: Vec3 = { x: 18, y: 0, z: 0 };
const B: Vec3 = { x: 20, y: 0, z: 0 };

/** Two units of strut (specs/structure.md's cost per unit). */
const COST = 2 * STRUT_COST_PER_UNIT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes a member on the site whose envelope reaches it and refuses it on the site whose envelope does not", async () => {
  await openSite(h, WIDE_SITE);
  await emptyYard(h);
  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  const wide = (await h.snapshot()).structure;

  // The still is Long Reach with the strut standing at the far edge of its
  // envelope; the refusal on Over the Wall leaves nothing to photograph, which
  // is the point.
  await h.advance(1);
  await h.capture(
    "bounds",
    "The same strut accepted on one site and refused on the other",
  );

  await openSite(h, NARROW_SITE);
  await emptyYard(h);
  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  const narrow = (await h.snapshot()).structure;

  assertLength(
    wide.members,
    1,
    "the member Site 4 takes, both ends inside its envelope of x -10..20 " +
      "(specs/sites.md § Site 4 — Long Reach)",
  );
  assertNear(
    wide.cost,
    COST,
    0.01,
    "the cost the accepted strut spends (specs/structure.md)",
  );

  assertLength(
    narrow.members,
    0,
    "the members Site 3 stands, its envelope of x -10..12 reaching neither " +
      "end of the same strut (specs/sites.md § Site 3 — Over the Wall)",
  );
  assertEqual(
    narrow.cost,
    0,
    "Site 3's cost after the refused edit, which changes nothing " +
      "(specs/structure.md)",
  );
});
