// editor/member-to-a-top-flange-node-accepted — an arm member ending at a
// top-flange node is accepted.
//
// specs/structure.md says of the ring's eight nodes: "Members attach to flange
// nodes like any other node, tower members to the bottom flange and arm members to
// the top." The rule that refuses a member for the ring's sake refuses only one
// that "would create a path of members between a bottom-flange or anchor node and
// a top-flange node" — so a member running from a TOP-flange node out to a node
// nothing else reaches stays inside the arm and is refused by nothing. This is the
// member every crane in the game is built out of: without it no arm ever leaves
// the ring.
//
// THE WORLD IS EMPTIED FIRST and the ring is seated alone, so the only rule that
// can speak is the one this check is about — in particular, the free end reaches
// no anchor and no bottom-flange node, which is what would genuinely refuse the
// placement. The ring's base corner is `(0, 4, 0)`, putting its top flange at
// `y 6`, and the member is a strut from the top-flange node `(0, 6, 0)` to the
// free node `(0, 10, 0)`: four units long against `STRUT_MAX_LEN` (`6`), inside
// site 1's envelope of `y 0..16`, and `40` against a budget of `3000` once the
// ring's `300` is spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotNull, assertTrue } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The ring's base corner: bottom flange at `y 4`, top flange at `y 6`. */
const CORNER = { x: 0, y: 4, z: 0 };

/** The top-flange node the arm member starts from. */
const TOP_FLANGE = { x: 0, y: 6, z: 0 };

/** The free node it ends at: no member, no anchor, no flange. */
const FREE = { x: 0, y: 10, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a member running from a top-flange node to a free node", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  assertNotNull(
    (await h.snapshot()).structure.ring,
    "the ring this check hangs an arm member on",
  );

  await h.debug.addMember(
    TOP_FLANGE.x,
    TOP_FLANGE.y,
    TOP_FLANGE.z,
    FREE.x,
    FREE.y,
    FREE.z,
    "strut",
  );

  await h.advance(1);
  await h.capture("placed", "The arm member leaving the ring's top flange");

  const { members } = (await h.snapshot()).structure;
  assertLength(
    members,
    1,
    "the members standing after a placement onto a top-flange node " +
      "(specs/structure.md)",
  );
  const ends = new Set(
    (members[0] === undefined ? [] : [members[0].a, members[0].b]).map(
      (one) => `${one.x},${one.y},${one.z}`,
    ),
  );
  assertTrue(
    ends.has(`${TOP_FLANGE.x},${TOP_FLANGE.y},${TOP_FLANGE.z}`) &&
      ends.has(`${FREE.x},${FREE.y},${FREE.z}`),
    "the two nodes the placed member runs between",
  );
});
