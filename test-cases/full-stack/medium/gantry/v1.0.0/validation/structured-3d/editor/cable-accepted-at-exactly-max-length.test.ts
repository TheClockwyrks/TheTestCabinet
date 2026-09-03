// editor/cable-accepted-at-exactly-max-length — a cable of exactly CABLE_MAX_LEN
// stands.
//
// specs/structure.md refuses a member placement only when "its length exceeds its
// material's maximum", and the material table gives the cable `CABLE_MAX_LEN`
// (`24`). "Exceeds" is strict, so the maximum itself is a legal length. The
// refusing side of the bound is its own point.
//
// SITE 4, Long Reach, because a `24`-unit member needs the room: its envelope is
// `x -10..20`, `y 0..20`, `z -8..8`, and `(-6, 0, -4)` to `(10, 16, 4)` is the
// vector `(16, 16, 8)`, whose length is exactly `sqrt(256 + 256 + 64) = 24`. Both
// ends are lattice nodes — every coordinate a multiple of `LATTICE_PITCH` (`2`) —
// and both lie inside that envelope.
//
// THE WORLD IS EMPTIED so the length rule is the only one that can speak: no
// obstacle stands anywhere, no ring stands so the arm-to-tower rule has no flange
// to trip on, no member joins the pair already, the ends are distinct, and `96` is
// well inside the site's budget of `5600`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { CABLE_MAX_LEN } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type MemberView,
} from "../harness";

/** Site 4, Long Reach: the one site with room for a member of `24`. */
const SITE = 3;

/** A cable whose length is exactly the material's maximum. */
const A = { x: -6, y: 0, z: -4 };
const B = { x: 10, y: 16, z: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accepts a cable whose length is exactly CABLE_MAX_LEN", async () => {
  await openSite(h, SITE);
  await clearAll(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "cable");

  await h.advance(1);
  await h.capture("cable-at-max", "The cable placed at exactly CABLE_MAX_LEN");

  const { members } = (await h.snapshot()).structure;
  assertLength(
    members,
    1,
    `the members standing after a cable of exactly ${CABLE_MAX_LEN} was placed ` +
      "(specs/structure.md refuses only a length that EXCEEDS the maximum)",
  );
  assertEqual(
    (members[0] as MemberView).material,
    "cable",
    "the material of the member that stands",
  );
});
