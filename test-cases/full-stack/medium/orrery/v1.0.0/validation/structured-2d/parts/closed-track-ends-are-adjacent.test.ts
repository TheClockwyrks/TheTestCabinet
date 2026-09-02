// parts/closed-track-ends-are-adjacent — a path whose last cell is not adjacent
// to its first refuses to close, and stays open.
//
// THE RULE. Placement rule 6: "A track's consecutive cells are adjacent, and a
// closed track's last cell is adjacent to its first and its path holds at least
// three cells" (`specs/parts.md`, Placement rules). `specs/parts.md` says the
// same under Track: "A track is `closed` when its last cell is adjacent to its
// first and the editor has joined them into a loop, as `specs/editor.md`
// describes; otherwise it is open." Adjacency is `specs/field.md`'s: "Two hexes
// are adjacent when their difference is one of `DIRS`." `closeTrack` "Joins that
// track's last cell to its first, exactly as closing a path in `specs/editor.md`
// does", and the surface "throws an `Error` naming the first rule it breaks"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. An empty machine on a posed challenge, with no run live. Two
// open tracks are laid, each of THREE cells, so the count half of rule 6 holds
// for both and only the adjacency of the ends separates them:
//
//   - a straight run `(0, 0)`, `(1, 0)`, `(2, 0)`, whose ends are two hexes
//     apart;
//   - a ring `(0, 2)`, `(1, 2)`, `(0, 3)`, whose ends are adjacent.
//
// Both are offered the close.
//
// THE VERDICT. The straight run's close is refused and it stays open; the ring's
// is taken and it reads back closed.

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

/** A three-cell run whose ends are apart, and a three-cell ring whose ends meet. */
const STRAIGHT: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0)];
const RING: readonly Hex[] = [at(0, 2), at(1, 2), at(0, 3)];

/** Whether a path's consecutive cells are adjacent, as rule 6's first half asks. */
function consecutivelyAdjacent(cells: readonly Hex[]): boolean {
  return cells.every(
    (cell, i) => i === 0 || adjacent(cells[i - 1] as Hex, cell),
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses to close a path whose last cell is not adjacent to its first", async () => {
  await openChallengeDocument(h, BARE);

  // The geometry the check claims to be posing: two legal open paths of the same
  // length, differing only in whether their ends meet.
  for (const path of [STRAIGHT, RING]) {
    for (const cell of path) {
      assertEqual(onField(cell), true, `the cell (${cell.q}, ${cell.r}) is on the field`);
    }
    assertEqual(
      consecutivelyAdjacent(path),
      true,
      `the path ${pathOf(path)} is laid of consecutively adjacent cells`,
    );
    assertEqual(path.length, 3, `the path ${pathOf(path)} holds three cells`);
  }
  assertEqual(
    adjacent(STRAIGHT[STRAIGHT.length - 1] as Hex, STRAIGHT[0] as Hex),
    false,
    "the straight run's last cell is not adjacent to its first",
  );
  assertEqual(
    adjacent(RING[RING.length - 1] as Hex, RING[0] as Hex),
    true,
    "the ring's last cell is adjacent to its first",
  );

  const straight = await placeTrack(h, STRAIGHT);
  const ring = await placeTrack(h, RING);

  const straightClosed = await refusesPlacement(() => h.debug.closeTrack(straight));
  const straightState = partById(await h.snapshot(), straight);
  const ringClosed = await refusesPlacement(() => h.debug.closeTrack(ring));
  const ringState = partById(await h.snapshot(), ring);

  await h.advance(1);
  await captureStill(h, "refused");

  assertEqual(
    straightClosed,
    true,
    "closing a path whose ends are two hexes apart is refused",
  );
  assertEqual(straightState?.closed, false, "that track stays open");
  assertEqual(
    pathOf(straightState?.cells),
    pathOf(STRAIGHT),
    "and it still holds the cells it was laid as",
  );
  assertEqual(ringClosed, false, "closing a path whose ends are adjacent is taken");
  assertEqual(ringState?.closed, true, "that track reads back closed");
  assertEqual(
    pathOf(ringState?.cells),
    pathOf(RING),
    "and it still holds the cells it was laid as",
  );
  assertEqual((await partIds(h)).length, 2, "the machine holds the two tracks");
});
