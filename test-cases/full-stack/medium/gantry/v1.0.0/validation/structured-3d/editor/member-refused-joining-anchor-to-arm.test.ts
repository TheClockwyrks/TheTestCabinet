// editor/member-refused-joining-anchor-to-arm — the arm-to-tower rule reads
// through whole paths, not through the placed member's own two ends.
//
// `specs/structure.md` § The editor's rules states the rule as a question about
// paths: a member placement is refused when "it would join the arm to the tower
// anywhere but through the ring: **adding it would create a path of members**
// between a bottom-flange or anchor node and a top-flange node." § The slew ring
// says the same from the structure's side: "Everything connected through intact
// members to the top flange is the arm ... everything connected to the bottom
// flange or to an anchor is the tower."
//
// So the closing member here touches neither flange: a chain of struts already
// hangs off one top-flange node and reaches down to a free node beside an anchor,
// and the member offered joins that free node to the anchor. Its own two ends say
// nothing — one is a plain lattice node, the other is an anchor — and only the
// path it completes, from the anchor through the chain to the top flange, refuses
// it. A build that inspects the two ends alone places it and hands the player a
// crane whose arm cannot turn, which is why this edge case is its own point.
//
// Everything else is kept out of the way: the ring and the three struts are the
// whole structure, the yard is empty, every node is on the lattice inside site 1's
// envelope, no strut is longer than `STRUT_MAX_LEN`, and the closing strut joins
// two nodes nothing joins already.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotNull } from "../assert";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The ring's base corner: bottom flange at y `4`, top flange at y `6`. */
const CORNER = { x: 0, y: 4, z: 0 };

/**
 * The chain: from a top-flange node out and then straight down to a free node
 * one strut short of the ground anchor at the origin.
 */
const CHAIN = [
  { a: [0, 6, 0], b: [-4, 6, 0] },
  { a: [-4, 6, 0], b: [-4, 0, 0] },
] as const;

/** The closing strut: the free foot of the chain to the anchor beside it. */
const CLOSING = { a: [-4, 0, 0], b: [0, 0, 0] } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places no member that completes a path from an anchor to the top flange", async () => {
  await openSite(h, 0);
  await emptyYard(h);

  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  for (const { a, b } of CHAIN) {
    await h.debug.addMember(a[0], a[1], a[2], b[0], b[1], b[2], "strut");
  }

  const hung = await h.snapshot();
  assertNotNull(hung.structure.ring, "the ring the placement landed");
  assertLength(
    hung.structure.members,
    CHAIN.length,
    "the chain hanging off the top flange, which the rule accepts: it reaches " +
      "no anchor and no bottom-flange node (specs/structure.md)",
  );

  await h.debug.addMember(
    CLOSING.a[0],
    CLOSING.a[1],
    CLOSING.a[2],
    CLOSING.b[0],
    CLOSING.b[1],
    CLOSING.b[2],
    "strut",
  );

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("refused", "The chain the closing strut did not complete");

  assertLength(
    s.structure.members,
    CHAIN.length,
    "the members standing: the closing strut would create a path between an " +
      "anchor and a top-flange node, so it is refused (specs/structure.md)",
  );
});
