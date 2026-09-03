// editor/member-to-a-bottom-flange-node-accepted — a tower member ending at a
// bottom-flange node is accepted.
//
// specs/structure.md says of the ring's eight nodes: "Members attach to flange
// nodes like any other node, tower members to the bottom flange and arm members to
// the top." The rule that refuses a member for the ring's sake refuses only one
// that "would create a path of members between a bottom-flange or anchor node and
// a top-flange node" — so a member running from an anchor to a BOTTOM-flange node
// joins the tower to itself and is refused by nothing. This is the member every
// crane in the game is built out of: without it no tower ever reaches its ring.
//
// THE WORLD IS EMPTIED FIRST and the ring is seated alone, so the only rule that
// can speak is the one this check is about. The ring's base corner is `(0, 4, 0)`,
// putting its bottom flange at `y 4` and its top flange at `y 6`, both squares
// inside site 1's envelope, and its `y` is not `0`. The member is a strut from the
// anchor `(0, 0, 0)` to the bottom-flange node `(0, 4, 0)`: four units long
// against `STRUT_MAX_LEN` (`6`), inside the envelope, joining two nodes nothing
// else joins, clear of an emptied yard's obstacles, and `40` against a budget of
// `3000` once the ring's `300` is spent.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotNull, assertTrue } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The ring's base corner: bottom flange at `y 4`, top flange at `y 6`. */
const CORNER = { x: 0, y: 4, z: 0 };

/** The anchor the tower member starts from (specs/sites.md, site 1). */
const ANCHOR = { x: 0, y: 0, z: 0 };

/** The bottom-flange node it ends at: the corner itself. */
const BOTTOM_FLANGE = CORNER;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places a member running from an anchor to a bottom-flange node", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  assertNotNull(
    (await h.snapshot()).structure.ring,
    "the ring this check hangs a tower member on",
  );

  await h.debug.addMember(
    ANCHOR.x,
    ANCHOR.y,
    ANCHOR.z,
    BOTTOM_FLANGE.x,
    BOTTOM_FLANGE.y,
    BOTTOM_FLANGE.z,
    "strut",
  );

  await h.advance(1);
  await h.capture(
    "placed",
    "The tower member reaching the ring's bottom flange",
  );

  const { members } = (await h.snapshot()).structure;
  assertLength(
    members,
    1,
    "the members standing after a placement onto a bottom-flange node " +
      "(specs/structure.md)",
  );
  const ends = new Set(
    (members[0] === undefined ? [] : [members[0].a, members[0].b]).map(
      (one) => `${one.x},${one.y},${one.z}`,
    ),
  );
  assertTrue(
    ends.has(`${ANCHOR.x},${ANCHOR.y},${ANCHOR.z}`) &&
      ends.has(`${BOTTOM_FLANGE.x},${BOTTOM_FLANGE.y},${BOTTOM_FLANGE.z}`),
    "the two nodes the placed member runs between",
  );
});
