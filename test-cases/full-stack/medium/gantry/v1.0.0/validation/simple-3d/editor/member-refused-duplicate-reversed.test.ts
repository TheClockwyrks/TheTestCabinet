// editor/member-refused-duplicate-reversed — the duplicate rule reads the two
// ends either way round, and reads them whatever the material.
//
// `specs/structure.md` § The editor's rules: "a member already joins the same two
// nodes, **in either direction**". The rule is stated on the pair of nodes rather
// than on the ordered ends or on the material, so a `cable` placed b-to-a after a
// `strut` placed a-to-b is refused exactly as the same-way-round duplicate is, and
// "a refused edit changes nothing".
//
// This is the edge case its own validator: the ends are handed over in the
// opposite order and the material is different, so a build that keyed its check
// on the ordered pair, or on the pair and the material together, lands a second
// member here and passes the same-way-round check. One member standing, still a
// strut, is the reading. The world is the two nodes and nothing else: no ring, no
// obstacle, both nodes on the lattice inside site 1's envelope, the distance well
// inside both materials' maximum length.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The two nodes: joined a-to-b as a strut, then b-to-a as a cable. */
const A = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a member given the ends the other way round", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.addMember(A.x, A.y, A.z, B.x, B.y, B.z, "strut");
  assertLength(
    (await h.snapshot()).structure.members,
    1,
    "the member the first placement lands (specs/structure.md)",
  );

  await h.debug.addMember(B.x, B.y, B.z, A.x, A.y, A.z, "cable");

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "refused",
    "The one member the reversed duplicate did not join",
  );

  assertLength(
    s.structure.members,
    1,
    "the members joining those two nodes: a duplicate in either direction is " +
      "refused (specs/structure.md)",
  );
  assertEqual(
    s.structure.members[0]?.material,
    "strut",
    "the material of the member standing: the first placement's, unreplaced",
  );
});
