// parts/closed-track-holds-three-cells — a path of fewer than three cells refuses
// to close, though its ends are adjacent.
//
// THE RULE. Placement rule 6: "A track's consecutive cells are adjacent, and a
// closed track's last cell is adjacent to its first and its path holds at least
// three cells" (`specs/parts.md`, Placement rules). `closeTrack` "Joins that
// track's last cell to its first, exactly as closing a path in `specs/editor.md`
// does", and the surface "throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`). A track that does not close is open: "A track is
// `closed` when its last cell is adjacent to its first and the editor has joined
// them into a loop ... otherwise it is open" (`specs/parts.md`, Track).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. One
// track is laid on `(0, 0)` and `(1, 0)`: two adjacent cells, so its consecutive
// cells are adjacent AND its last cell is adjacent to its first — every part of
// rule 6 holds of it but the count. Its close is offered and refused. The same
// track is then extended by `(0, 1)`, which is adjacent to the live end and to
// the first cell, making a three-cell ring, and its close is offered again.
// Nothing about the ends changed between the two offers; only the count did.
//
// THE VERDICT. The two-cell track's close is refused and it stays open with both
// its cells; the three-cell track's close is taken.

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

/** The two cells laid first, and the third that makes the count up to three. */
const PAIR: readonly Hex[] = [at(0, 0), at(1, 0)];
const THIRD: Hex = at(0, 1);

/** The least a closed path may hold (`specs/parts.md`, placement rule 6). */
const CLOSED_MIN_CELLS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses to close a two-cell track whose ends are adjacent", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing: every part of rule 6 but the
  // count holds of the two-cell path.
  for (const hex of [...PAIR, THIRD]) {
    assertEqual(onField(hex), true, `the hex (${hex.q}, ${hex.r}) is on the field`);
  }
  assertEqual(
    adjacent(PAIR[0] as Hex, PAIR[1] as Hex),
    true,
    "the two cells are adjacent, so the path's consecutive cells are adjacent",
  );
  assertEqual(
    adjacent(PAIR[PAIR.length - 1] as Hex, PAIR[0] as Hex),
    true,
    "and its last cell is adjacent to its first, so only the count is short",
  );
  assertEqual(PAIR.length < CLOSED_MIN_CELLS, true, "the path holds fewer than three cells");
  assertEqual(
    adjacent(PAIR[PAIR.length - 1] as Hex, THIRD),
    true,
    "the third cell is adjacent to the live end, so it may be laid",
  );
  assertEqual(
    adjacent(THIRD, PAIR[0] as Hex),
    true,
    "and adjacent to the first cell, so the ends still meet once it is",
  );

  const track = await placeTrack(h, PAIR);

  const closedShort = await refusesPlacement(() => h.debug.closeTrack(track));
  const shortState = partById(await h.snapshot(), track);

  const extended = await refusesPlacement(() =>
    h.debug.extendTrack(track, THIRD.q, THIRD.r),
  );
  const closedLong = await refusesPlacement(() => h.debug.closeTrack(track));
  const longState = partById(await h.snapshot(), track);

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    closedShort,
    true,
    "closing a two-cell path is refused: a closed track holds at least three cells",
  );
  assertEqual(shortState?.closed, false, "that track stays open");
  assertEqual(
    pathOf(shortState?.cells),
    pathOf(PAIR),
    "and it still holds both the cells it was laid as",
  );

  assertEqual(extended, false, "the third cell is laid on the still-open track");
  assertEqual(closedLong, false, "closing the three-cell path is taken");
  assertEqual(longState?.closed, true, "that track reads back closed");
  assertEqual(
    pathOf(longState?.cells),
    pathOf([...PAIR, THIRD]),
    "and it holds the three cells the loop is made of",
  );
  assertEqual((await partIds(h)).length, 1, "the track is the whole machine");
});
