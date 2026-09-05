// editor/the-ghost-reads-legal-or-illegal — a live drag draws a ghost at the
// targeted hex, and draws it differently where the placement rules refuse it.
//
// THE RULE. "While a drag is live A GHOST OF THE PART IS DRAWN AT THE TARGETED
// HEX, VISIBLY LEGAL OR ILLEGAL UNDER THE PLACEMENT RULES, and `part-cw`,
// `part-ccw`, `part-grow`, and `part-shrink` act on the ghost" (`specs/editor.md`,
// Dragging). The rules it reads against are `specs/parts.md`'s six, and how either
// state is drawn is the build's — so what this check reads is that the targeted
// hex changed when the ghost arrived, and changed AGAIN when the same ghost at the
// same hex became illegal, not what either looked like.
//
// POSING THE TWO STATES AT ONE HEX. The two frames must differ in the ghost's
// legality and in nothing else that is visible where the reading is taken, so the
// thing that makes the ghost illegal is put four hexes away from where the picture
// is read. The challenge's one product is a CHAIN of four motes running east, so
// its set's footprint is "the molecule pattern for a rise, and for a set the
// pattern plus, when the product repeats..." (`specs/parts.md`) — four hexes,
// `(-2, 0)` through `(1, 0)` when the set is anchored on `(-2, 0)`. A `wane`, whose
// footprint is one hex (`specs/sigils.md`), is then placed on `(1, 0)`, the far end
// of that footprint. Placement rule 2 — "Sigil footprints, rise and set footprints
// included, are pairwise disjoint" — refuses the same ghost at the same anchor,
// and the placement oracle says so both ways before the build is asked anything.
//
// WHERE THE PICTURE IS READ. A `60` by `60` square on the centre of `(-2, 0)`, the
// ANCHOR the drag targets. That covers the whole of that hex — a hex's own
// circumradius is `HEX_PITCH / sqrt(3)`, about `27.7` — and stops `114` short of
// the blocking `wane`'s centre, so the `wane` cannot be what the reading sees. The
// check proves that rather than asserting it in prose: the same square is read
// with the `wane` on the field and no drag live, and it must differ from the bare
// square by less than the ghost does.
//
// THE VERDICT. Three readings of that one square. The ghost's arrival changes it;
// the blocker alone leaves it as the bare square; and the legal ghost and the
// illegal ghost are not the same picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import {
  at,
  hexCenter,
  targetHex,
  traySlot,
  type Hex,
  type StagePoint,
} from "../field";
import {
  challenge,
  link,
  loneMote,
  molecule,
  mote,
  setPart,
  sigilPart,
} from "../formats";
import { placementFault } from "../parts";
import {
  captureStill,
  centerOf,
  createHarness,
  differingShare,
  moveTo,
  openChallengeDocument,
  partIds,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
  type PixelRect,
} from "../harness";

/** A product of four `dust` chained east, so its set's footprint is four hexes long. */
const CHAINED = challenge({
  name: "Chained",
  reagents: [loneMote("dust")],
  products: [
    molecule(
      [
        mote(0, 0, "dust"),
        mote(1, 0, "dust"),
        mote(2, 0, "dust"),
        mote(3, 0, "dust"),
      ],
      [
        link(at(0, 0), at(1, 0)),
        link(at(1, 0), at(2, 0)),
        link(at(2, 0), at(3, 0)),
      ],
    ),
  ],
  permitted: ["arm"],
});

/** `CHAINED`'s tray: `arm`, then the one rise, then the one set. */
const SET_SLOT = 2;

/** Where the set's ghost is anchored: its footprint runs `(-2, 0)` to `(1, 0)`. */
const ANCHOR: Hex = at(-2, 0);

/** The far end of that footprint, four hexes from the anchor's centre. */
const BLOCKER: Hex = at(1, 0);

/** A point inside the field region and more than `HEX_HIT_R` from every centre. */
const OFF_EVERY_HEX: StagePoint = { x: 940, y: 304 };

/** Half the square read on the anchor: past a hex's `27.7` circumradius. */
const READ_HALF = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The square on the anchor hex's centre, read back as RGBA. */
function readAnchor(): Promise<PixelRect> {
  const centre = hexCenter(ANCHOR);
  return h.pixelRect(
    centre.x - READ_HALF,
    centre.y - READ_HALF,
    READ_HALF * 2,
    READ_HALF * 2,
  );
}

/** Hold the set's ghost on the anchor, draw a frame, and end the drag placing nothing. */
async function ghostOnAnchor(outputId: string): Promise<PixelRect> {
  await pressAt(h, centerOf(traySlot(SET_SLOT)));
  await moveTo(h, hexCenter(ANCHOR));
  await h.advance(1);

  const drag = (await h.snapshot()).editor.drag;
  assertEqual(
    drag?.kind,
    "place",
    "the press on the set entry opened a place drag",
  );
  assertEqual(
    drag?.kind === "place" ? `${drag.at?.q},${drag.at?.r}` : null,
    `${ANCHOR.q},${ANCHOR.r}`,
    "and the drag targets the anchor hex the square below is read on",
  );

  await captureStill(h, outputId);
  const picture = await readAnchor();

  await moveTo(h, OFF_EVERY_HEX);
  await releasePointer(h);
  await h.advance(1);
  return picture;
}

it("draws a ghost at the targeted hex, and draws it differently where the rules refuse it", async () => {
  const patterns = { reagents: CHAINED.reagents, products: CHAINED.products };
  const ghost = setPart(0, ANCHOR.q, ANCHOR.r, 0);
  const wane = sigilPart("wane", BLOCKER.q, BLOCKER.r, 0);
  assertNull(
    placementFault([ghost], patterns),
    "the set on (-2, 0) breaks none of the six placement rules on a bare field",
  );
  assertEqual(
    placementFault([wane, ghost], patterns)?.rule,
    2,
    "with a wane on (1, 0) the same set breaks rule 2, footprints being pairwise disjoint",
  );
  assertNull(
    targetHex(OFF_EVERY_HEX.x, OFF_EVERY_HEX.y),
    "the point each drag is released over targets no hex, so neither gesture places anything",
  );

  await openChallengeDocument(h, CHAINED);
  await h.advance(1);
  const bare = await readAnchor();

  const legal = await ghostOnAnchor("legal");
  assertEqual(
    (await partIds(h)).length,
    0,
    "the first drag was released off every hex, so it placed nothing",
  );

  await placePart(h, "wane", BLOCKER);
  await h.advance(1);
  const blocked = await readAnchor();

  const illegal = await ghostOnAnchor("illegal");
  assertEqual(
    (await partIds(h)).length,
    1,
    "the second drag placed nothing either: the wane is the machine's only part",
  );

  assertEqual(
    differingShare(bare, blocked),
    0,
    "the wane four hexes away changes nothing in the square the ghost is read on",
  );
  assertGreaterThan(
    differingShare(bare, legal),
    0,
    "a ghost of the part is drawn at the targeted hex while the drag is live",
  );
  assertGreaterThan(
    differingShare(legal, illegal),
    0,
    "and the same ghost on the same hex is drawn differently once the rules refuse it",
  );
});
