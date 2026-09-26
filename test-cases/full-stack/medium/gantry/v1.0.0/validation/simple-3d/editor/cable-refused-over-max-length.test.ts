// editor/cable-refused-over-max-length — a cable longer than CABLE_MAX_LEN is
// refused.
//
// specs/structure.md: a member placement is refused when "its length exceeds its
// material's maximum", and the material table gives the cable `CABLE_MAX_LEN`
// (`24`). This is the refusing side of that bound; the accepting side, a cable of
// exactly `24`, is its own point.
//
// SITE 4, Long Reach, because the placement has to be past `24` and still fit
// everything else: its envelope is `x -10..20`, `y 0..20`, `z -8..8`, and
// `(-10, 0, -4)` to `(14, 8, 2)` is the vector `(24, 8, 6)`, whose length is
// exactly `sqrt(576 + 64 + 36) = 26`. Both ends are lattice nodes inside that
// envelope, so the envelope rule cannot be what refuses it — which is what makes a
// refusal here a refusal for LENGTH.
//
// THE WORLD IS EMPTIED for the rest: no obstacle stands anywhere, no ring stands
// so the arm-to-tower rule has no flange to trip on, no member joins the pair
// already, the ends are distinct, and `104` is well inside the site's budget of
// `5600`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import { CABLE_MAX_LEN } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** Site 4, Long Reach. */
const SITE = 3;

/** A cable of `26`, two units past the material's maximum. */
const A = { x: -10, y: 0, z: -4 };
const B = { x: 14, y: 8, z: 2 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a cable longer than CABLE_MAX_LEN", async () => {
  await openSite(h, SITE);
  await emptyYard(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "cable");

  await h.advance(1);
  await h.capture(
    "cable-over-max",
    "The build screen after a cable past CABLE_MAX_LEN was refused",
  );

  assertLength(
    (await h.snapshot()).structure.members,
    0,
    "the members standing after a cable of 26 was placed, past CABLE_MAX_LEN " +
      `(${CABLE_MAX_LEN}) (specs/structure.md)`,
  );
});
