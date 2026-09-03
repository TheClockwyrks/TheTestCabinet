// editor/strut-refused-over-max-length — a strut longer than STRUT_MAX_LEN is
// refused.
//
// specs/structure.md: a member placement is refused when "its length exceeds its
// material's maximum", and the material table gives the strut `STRUT_MAX_LEN`
// (`6`). This is the refusing side of that bound; the accepting side, a strut of
// exactly `6`, is its own point.
//
// THE WORLD IS EMPTIED so the length rule is the only one that can refuse, and a
// refusal here therefore means the build enforced THIS rule. The strut runs from
// `(0, 0, 0)` to `(0, 8, 0)`, length `8`: both ends are lattice nodes inside
// site 1's envelope (`x -8..12`, `y 0..16`, `z -8..12`), they are distinct, no
// member joins them already, no obstacle stands anywhere, no ring stands so the
// arm-to-tower rule has no flange to trip on, and `80` is well inside the site's
// budget of `3000`.
//
// WHAT IS READ IS THAT NOTHING STANDS — "a refused edit changes nothing" — which
// is the one direction this point decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { STRUT_MAX_LEN } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** A strut two units past the material's maximum. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: STRUT_MAX_LEN + 2, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a strut longer than STRUT_MAX_LEN", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");

  await h.advance(1);
  await h.capture(
    "strut-over-max",
    "The build screen after a strut past STRUT_MAX_LEN was refused",
  );

  assertLength(
    (await h.snapshot()).structure.members,
    0,
    `the members standing after a strut of ${STRUT_MAX_LEN + 2} was placed, ` +
      `past STRUT_MAX_LEN (${STRUT_MAX_LEN}) (specs/structure.md)`,
  );
});
