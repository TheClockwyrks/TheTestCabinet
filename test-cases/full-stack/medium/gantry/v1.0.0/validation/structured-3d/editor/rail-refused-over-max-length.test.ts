// editor/rail-refused-over-max-length — a rail longer than RAIL_MAX_LEN is
// refused.
//
// specs/structure.md: a member placement is refused when "its length exceeds its
// material's maximum", and the material table gives the rail `RAIL_MAX_LEN`
// (`6`). This is the refusing side of that bound; the accepting side, a rail of
// exactly `6`, is its own point.
//
// THE RAIL IS HORIZONTAL so the OTHER placement-time rail rule cannot be what
// refuses it: `(0, 4, 0)` to `(8, 4, 0)` shares a `y`, so "it is a rail member and
// is not horizontal" is satisfied and the length is the only thing wrong with it.
// A refusal here is therefore a refusal for length.
//
// THE WORLD IS EMPTIED for the rest: both ends are lattice nodes inside site 1's
// envelope (`x -8..12`, `y 0..16`, `z -8..12`), they are distinct, no member joins
// them already, no obstacle stands anywhere, no ring stands so the arm-to-tower
// rule has no flange to trip on, and `144` is well inside the site's budget of
// `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { RAIL_MAX_LEN } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A horizontal rail two units past the material's maximum. */
const A = { x: 0, y: 4, z: 0 };
const B = { x: RAIL_MAX_LEN + 2, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a rail longer than RAIL_MAX_LEN", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "rail");

  await h.advance(1);
  await h.capture(
    "rail-over-max",
    "The build screen after a rail past RAIL_MAX_LEN was refused",
  );

  assertLength(
    (await h.snapshot()).structure.members,
    0,
    `the members standing after a horizontal rail of ${RAIL_MAX_LEN + 2} was ` +
      `placed, past RAIL_MAX_LEN (${RAIL_MAX_LEN}) (specs/structure.md)`,
  );
});
