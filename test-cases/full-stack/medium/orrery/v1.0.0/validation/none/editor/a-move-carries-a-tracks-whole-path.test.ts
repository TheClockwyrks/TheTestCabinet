// editor/a-move-carries-a-tracks-whole-path — moving a track shifts every cell of
// its path by the one offset, so the path keeps its shape and its `closed` flag.
//
// THE RULE. "The drag's offset is the targeted hex minus the pressed hex, and THE
// WHOLE PART TRANSLATES BY IT, A TRACK'S PATH INCLUDED" (`specs/editor.md`,
// Dragging). `specs/parts.md` says what a path is: "A `track` is AN ORDERED PATH
// of distinct hexes, `cells`... Consecutive cells are adjacent. A track is
// `closed` when its last cell is adjacent to its first and the editor has joined
// them into a loop; otherwise it is open." Nothing in a translation joins or
// parts a loop, so the flag the track carried is the flag it keeps.
//
// WHY THE PRESS LANDS ON AN INTERIOR CELL. "A press on an end cell of an open
// track begins laying rather than moving" (`specs/editor.md`, Laying track), so a
// move is opened from a cell that is neither `first` nor `last`. The path below is
// three cells running east and the press lands on the middle one.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE track, `(-1, 0)`,
// `(0, 0)`, `(1, 0)`, laid through the surface. Nothing else is on the field, so
// no footprint and no second track can be what shapes the result. The gesture
// presses `(0, 0)` and releases on `(0, 1)`, an offset of one hex southeast; the
// shifted path lies wholly on the field and touches nothing, which the placement
// oracle confirms.
//
// THE VERDICT. `cells` is the same three hexes each shifted by `(0, 1)`, in the
// same order, and `closed` is still `false`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { at, translate, type Hex } from "../field";
import { trackPart } from "../formats";
import { BARE } from "../fixtures";
import { placementFault } from "../parts";
import {
  captureStill,
  createHarness,
  dragHex,
  openChallengeDocument,
  partById,
  placeTrack,
  type Harness,
} from "../harness";

/** A three-cell open path running east, so its middle cell is neither end. */
const PATH: readonly Hex[] = [at(-1, 0), at(0, 0), at(1, 0)];

/** The interior cell the press lands on. */
const PRESSED: Hex = PATH[1] as Hex;

/** Where the pointer is released: one hex southeast of the pressed cell. */
const RELEASED: Hex = at(0, 1);

/** The offset the whole path must take. */
const OFFSET: Hex = at(RELEASED.q - PRESSED.q, RELEASED.r - PRESSED.r);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("shifts every cell by the one offset and keeps the path open", async () => {
  const shifted = PATH.map((cell) => translate(cell, OFFSET));
  assertNull(
    placementFault([trackPart(shifted)], {
      reagents: BARE.reagents,
      products: BARE.products,
    }),
    "the shifted path breaks none of the six placement rules, so the move commits",
  );

  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, PATH);

  await dragHex(h, PRESSED, RELEASED);
  await h.advance(1);
  await captureStill(h, "moved");

  const moved = partById(await h.snapshot(), track);
  assertDeepEqual(
    (moved?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    shifted.map((cell) => `${cell.q},${cell.r}`),
    "every cell of the path moved by the drag's one offset, in the order it was laid",
  );
  assertEqual(
    moved?.closed,
    false,
    "and the path that was open before the move is open after it",
  );
});
