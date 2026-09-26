// parts/sigil-footprints-are-disjoint — two sigil footprints never share a hex,
// the anchor hex included.
//
// THE RULE. Placement rule 2: "Sigil footprints, rise and set footprints
// included, are pairwise disjoint, and no track cell lies on any of them"
// (`specs/parts.md`, Placement rules). A sigil's hexes are its tabulated
// footprint placed at its pose (`specs/sigils.md`), and `bind`'s is two hexes:
// `(0, 0)` the first and `(1, 0)` the second. The surface "throws an `Error`
// naming the first rule it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. One
// `bind` is placed at `(0, 0)` at rotation `0`, so it holds `(0, 0)` and
// `(1, 0)`. Three more `bind`s are then offered:
//
//   - at `(1, 0)`, whose own ANCHOR falls on the standing sigil's second hex;
//   - at `(-1, 0)`, whose SECOND hex falls on the standing sigil's anchor;
//   - at `(2, 0)`, which holds `(2, 0)` and `(3, 0)` and touches neither.
//
// The two refused offers reach the standing footprint from opposite ends and by
// different hexes of their own, which is what "the anchor hex and every other
// footprint hex alike" asks for; the third is one step further out and shares
// nothing.
//
// THE VERDICT. Both overlapping offers are refused and add no part; the disjoint
// one is placed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { at, onField, sameHex, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placePart,
  type Harness,
} from "../harness";
import { sigilHexes } from "../parts";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(
  place: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** How many hexes two placed footprints share. */
function shared(left: readonly Hex[], right: readonly Hex[]): number {
  return left.filter((hex) => right.some((other) => sameHex(hex, other)))
    .length;
}

/** The standing sigil's anchor, and the three anchors offered against it. */
const STANDING: Hex = at(0, 0);
const OVER_THE_SECOND: Hex = at(1, 0);
const OVER_THE_ANCHOR: Hex = at(-1, 0);
const CLEAR: Hex = at(2, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a second sigil whose footprint covers any hex of a placed one", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing, from `specs/sigils.md`'s
  // footprint table.
  const standing = sigilHexes("bind", STANDING, 0);
  for (const anchor of [STANDING, OVER_THE_SECOND, OVER_THE_ANCHOR, CLEAR]) {
    for (const hex of sigilHexes("bind", anchor, 0)) {
      assertEqual(
        onField(hex),
        true,
        `the hex (${hex.q}, ${hex.r}) of the sigil at (${anchor.q}, ${anchor.r}) is on the field, so rule 1 refuses nothing here`,
      );
    }
  }
  assertEqual(
    shared(sigilHexes("bind", OVER_THE_SECOND, 0), standing),
    1,
    "the sigil offered at (1, 0) covers the standing sigil's second hex with its anchor",
  );
  assertEqual(
    shared(sigilHexes("bind", OVER_THE_ANCHOR, 0), standing),
    1,
    "the sigil offered at (-1, 0) covers the standing sigil's anchor with its second hex",
  );
  assertEqual(
    shared(sigilHexes("bind", CLEAR, 0), standing),
    0,
    "the sigil offered at (2, 0) shares no hex with the standing one",
  );

  const first = await placePart(h, "bind", STANDING, 0);

  const overSecond = await refusesPlacement(() =>
    h.debug.placePart("bind", OVER_THE_SECOND.q, OVER_THE_SECOND.r, 0),
  );
  const afterOverSecond = (await partIds(h)).length;
  const overAnchor = await refusesPlacement(() =>
    h.debug.placePart("bind", OVER_THE_ANCHOR.q, OVER_THE_ANCHOR.r, 0),
  );
  const afterOverAnchor = (await partIds(h)).length;

  let clear = -1;
  const clearRefused = await refusesPlacement(async () => {
    clear = await placePart(h, "bind", CLEAR, 0);
  });

  await h.advance(1);
  await captureStill(h, "overlap");

  assertEqual(
    overSecond,
    true,
    "a sigil whose anchor falls on a placed footprint hex is refused",
  );
  assertEqual(
    afterOverSecond,
    1,
    "that refusal added no part: the first sigil stands alone",
  );
  assertEqual(
    overAnchor,
    true,
    "a sigil whose second hex falls on a placed sigil's anchor is refused",
  );
  assertEqual(afterOverAnchor, 1, "that refusal added no part either");
  assertEqual(
    clearRefused,
    false,
    "a sigil whose footprint shares no hex with the placed one is taken",
  );

  const snapshot = await h.snapshot();
  assertEqual(
    partById(snapshot, first)?.kind,
    "bind",
    "the first sigil still stands",
  );
  assertEqual(
    partById(snapshot, clear)?.kind,
    "bind",
    "the disjoint sigil stands beside it",
  );
  assertEqual(
    (await partIds(h)).length,
    2,
    "the machine holds the two disjoint sigils and neither refused one",
  );
});
