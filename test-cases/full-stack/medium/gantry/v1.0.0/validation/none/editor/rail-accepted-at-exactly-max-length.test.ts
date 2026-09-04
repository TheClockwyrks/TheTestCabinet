// editor/rail-accepted-at-exactly-max-length — a rail of exactly RAIL_MAX_LEN
// stands.
//
// specs/structure.md refuses a member placement only when "its length exceeds its
// material's maximum", and the material table gives the rail `RAIL_MAX_LEN`
// (`6`). "Exceeds" is strict, so the maximum itself is a legal length. The
// refusing side of the bound is its own point.
//
// THE RAIL IS PLACED HORIZONTAL, which is the one other rule a rail meets at
// placement time: "it is a rail member and is not horizontal" is a refusal, and
// "The first rule is enforced the moment a rail member is placed; the rest are
// checked whenever the structure is readied". `(0, 4, 0)` to `(6, 4, 0)` shares a
// `y`, so that rule is satisfied and the length rule is the only one left that
// could speak.
//
// THE WORLD IS EMPTIED for the rest: both ends are lattice nodes inside site 1's
// envelope (`x -8..12`, `y 0..16`, `z -8..12`), no obstacle stands anywhere, no
// ring stands so the arm-to-tower rule has no flange to trip on, no member joins
// the pair already, and `108` is well inside the site's budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { RAIL_MAX_LEN } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MemberView,
} from "../harness";

/** A horizontal rail whose length is exactly the material's maximum. */
const A = { x: 0, y: 4, z: 0 };
const B = { x: RAIL_MAX_LEN, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a horizontal rail whose length is exactly RAIL_MAX_LEN", async () => {
  await openSite(h, 0);
  await clearAll(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "rail");

  await h.advance(1);
  await h.capture("rail-at-max", "The rail placed at exactly RAIL_MAX_LEN");

  const { members } = (await h.snapshot()).structure;
  assertLength(
    members,
    1,
    `the members standing after a rail of exactly ${RAIL_MAX_LEN} was placed ` +
      "(specs/structure.md refuses only a length that EXCEEDS the maximum)",
  );
  assertEqual(
    (members[0] as MemberView).material,
    "rail",
    "the material of the member that stands",
  );
});
