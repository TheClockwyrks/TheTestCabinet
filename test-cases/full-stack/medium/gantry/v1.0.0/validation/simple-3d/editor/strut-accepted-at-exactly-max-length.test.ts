// editor/strut-accepted-at-exactly-max-length — a strut of exactly STRUT_MAX_LEN
// stands.
//
// specs/structure.md refuses a member placement only when "its length exceeds its
// material's maximum", and the material table gives the strut `STRUT_MAX_LEN`
// (`6`). "Exceeds" is strict, so the maximum itself is a legal length and this is
// the accepting side of that bound — the refusing side is its own point.
//
// THE WORLD IS EMPTIED so the length rule is the only one that can speak. The
// strut runs from `(0, 0, 0)` to `(0, 6, 0)`, both lattice nodes inside site 1's
// envelope (`x -8..12`, `y 0..16`, `z -8..12`); with no obstacles its segment
// reaches inside none, with no ring the arm-to-tower rule has no flange to trip
// on, no member already joins the pair, the ends are distinct, and `60` is well
// inside the site's budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { STRUT_MAX_LEN } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MemberView,
} from "../harness";

/** A strut whose length is exactly the material's maximum. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: STRUT_MAX_LEN, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a strut whose length is exactly STRUT_MAX_LEN", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");

  await h.advance(1);
  await h.capture("strut-at-max", "The strut placed at exactly STRUT_MAX_LEN");

  const { members } = (await h.snapshot()).structure;
  assertLength(
    members,
    1,
    `the members standing after a strut of exactly ${STRUT_MAX_LEN} was placed ` +
      "(specs/structure.md refuses only a length that EXCEEDS the maximum)",
  );
  assertEqual(
    (members[0] as MemberView).material,
    "strut",
    "the material of the member that stands",
  );
});
