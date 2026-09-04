// parts/two-tracks-never-share-a-hex — no hex is a cell of two tracks.
//
// THE RULE. Placement rule 3: "No hex is a cell of two tracks, or of one track
// twice" (`specs/parts.md`, Placement rules). The surface "throws an `Error`
// naming the first rule it breaks" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. A
// first open track is laid on `(0, 0)`, `(1, 0)`, `(2, 0)`. Then:
//
//   - a fresh one-cell track is offered on `(1, 0)`, a cell the first track
//     already holds;
//   - a second track is laid clear of it, on `(1, 1)`, and offered `(1, 0)` as an
//     extension — adjacent to its live end, on the field, and a cell of the first
//     track;
//   - the same second track is offered `(0, 1)`, equally adjacent and held by
//     nobody.
//
// Every hex named is on the field and adjacent where it needs to be, so placement
// rules 1 and 6 hold throughout and only rule 3 separates the offers.
//
// THE VERDICT. Both offers onto the first track's cell are refused, the fresh one
// adding no part and the extension leaving the second path as it was; the offer
// onto the free hex is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { adjacent, at, onField, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  partIds,
  placeTrack,
  type Harness,
} from "../harness";

/**
 * Whether the surface REFUSED a placement: "Each placement is checked against
 * the placement rules of `specs/parts.md` alone, and throws an `Error` naming
 * the first rule it breaks" (`specs/instrumentation.md`, The machine).
 */
async function refusesPlacement(place: () => Promise<unknown>): Promise<boolean> {
  try {
    await place();
    return false;
  } catch {
    return true;
  }
}

/** A track's cells, as a string a failure reads at a glance. */
function pathOf(cells: readonly Hex[] | null | undefined): string {
  return (cells ?? []).map((cell) => `${cell.q},${cell.r}`).join(" ");
}

/** The first path, the second's one cell, the contested hex, and the free one. */
const FIRST: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0)];
const SECOND_START: Hex = at(1, 1);
const CONTESTED: Hex = at(1, 0);
const FREE: Hex = at(0, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a track cell on a hex another track already holds", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing.
  for (const hex of [...FIRST, SECOND_START, FREE]) {
    assertEqual(onField(hex), true, `the hex (${hex.q}, ${hex.r}) is on the field`);
  }
  assertEqual(
    adjacent(SECOND_START, CONTESTED),
    true,
    "the contested hex is adjacent to the second track's live end, so rule 6 refuses nothing",
  );
  assertEqual(
    adjacent(SECOND_START, FREE),
    true,
    "so is the free hex the control extension takes",
  );
  assertEqual(
    FIRST.some((cell) => cell.q === CONTESTED.q && cell.r === CONTESTED.r),
    true,
    "the contested hex is a cell of the first track",
  );
  assertEqual(
    FIRST.some((cell) => cell.q === FREE.q && cell.r === FREE.r),
    false,
    "the free hex is a cell of neither track",
  );

  const first = await placeTrack(h, FIRST);

  const freshOnCell = await refusesPlacement(() =>
    h.debug.placeTrack(CONTESTED.q, CONTESTED.r),
  );
  const afterFresh = (await partIds(h)).length;

  const second = await placeTrack(h, [SECOND_START]);
  const extendOntoCell = await refusesPlacement(() =>
    h.debug.extendTrack(second, CONTESTED.q, CONTESTED.r),
  );
  const afterExtend = pathOf(partById(await h.snapshot(), second)?.cells);
  const extendOntoFree = await refusesPlacement(() =>
    h.debug.extendTrack(second, FREE.q, FREE.r),
  );
  const afterFree = pathOf(partById(await h.snapshot(), second)?.cells);

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    freshOnCell,
    true,
    "a fresh one-cell track on a hex another track holds is refused",
  );
  assertEqual(afterFresh, 1, "that refusal added no part: the first track stands alone");
  assertEqual(
    extendOntoCell,
    true,
    "extending the second track onto the first track's cell is refused",
  );
  assertEqual(
    afterExtend,
    pathOf([SECOND_START]),
    "the refused extension left the second path as it was",
  );
  assertEqual(
    extendOntoFree,
    false,
    "extending the second track onto a hex neither track holds is taken",
  );
  assertEqual(
    afterFree,
    pathOf([SECOND_START, FREE]),
    "the taken extension is the second path's second cell",
  );

  const snapshot = await h.snapshot();
  assertEqual(
    pathOf(partById(snapshot, first)?.cells),
    pathOf(FIRST),
    "the first track still holds exactly the cells it was laid as",
  );
  assertEqual((await partIds(h)).length, 2, "the machine holds the two tracks");
});
