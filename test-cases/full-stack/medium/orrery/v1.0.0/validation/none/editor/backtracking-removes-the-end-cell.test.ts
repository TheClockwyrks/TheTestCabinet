// editor/backtracking-removes-the-end-cell — while laying, moving onto the cell
// just behind the live end drops the end cell, and that cell becomes the live end.
//
// THE RULE. "While laying ... MOVING BACK ONTO THE CELL JUST BEHIND THE LIVE END
// REMOVES THE END CELL" (`specs/editor.md`, Laying track). The lay runs on: only
// "the release ends the lay, leaving the path as laid".
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE track laid through the
// surface, `(0, 0)`, `(1, 0)`, `(2, 0)` — three cells, which is what the review
// item's "a path of three or more cells" asks for and what keeps the cell behind
// the live end, `(1, 0)`, distinct from the path's other end, `(0, 0)`. Nothing
// else is on the field. The lay is opened by a press on `(2, 0)`, the `last` end,
// and the pointer then moves back onto `(1, 0)`.
//
// WHY THE OTHER END MATTERS. The same section makes moving onto the path's other
// end CLOSE the track, and settles the collision between the two rules — "Removal
// outranks closing, so a path of two cells is shortened rather than closed". At
// three cells the two rules do not even meet: `(1, 0)` is the cell behind the live
// end and is not an end.
//
// AND THE LIVE END REALLY MOVED. After the removal the pointer steps onto
// `(1, -1)`, which is adjacent to `(1, 0)` and NOT adjacent to the dropped
// `(2, 0)`. So the step can only be appended by a lay whose live end really is the
// cell behind: a build that kept the end cell has nothing to append it to.
//
// THE VERDICT. The move back leaves the path `(0, 0)`, `(1, 0)`, and the step that
// follows leaves it `(0, 0)`, `(1, 0)`, `(1, -1)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertTrue } from "../assert";
import { adjacent, at, hexCenter, sameHex, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  moveTo,
  openChallengeDocument,
  partById,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** A three-cell open path running east. */
const PATH: readonly Hex[] = [at(0, 0), at(1, 0), at(2, 0)];

/** The live end a press on the `last` end lays from. */
const LIVE: Hex = PATH[2] as Hex;

/** The cell just behind the live end. */
const BEHIND: Hex = PATH[1] as Hex;

/** A bare hex adjacent to `BEHIND` and NOT to the end cell the backtrack drops. */
const ONWARD: Hex = at(1, -1);

/** A path, as the strings a reading compares. */
function spelled(cells: readonly { q: number; r: number }[]): string[] {
  return cells.map((cell) => `${cell.q},${cell.r}`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the end cell and lays on from the cell behind it", async () => {
  assertTrue(
    !sameHex(BEHIND, PATH[0] as Hex),
    "the cell behind the live end is not the path's other end, so no closing rule is in play",
  );
  assertTrue(
    adjacent(BEHIND, ONWARD),
    "the hex laid afterwards is adjacent to the cell behind the live end",
  );
  assertTrue(
    !adjacent(LIVE, ONWARD),
    "and not adjacent to the end cell the backtrack drops, so only a moved live end can take it",
  );

  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, PATH);

  const seen = await captureReplay(h, "shortened", async () => {
    await h.advance(1);
    await pressAt(h, hexCenter(LIVE));

    await moveTo(h, hexCenter(BEHIND));
    await h.advance(1);
    const shortened = spelled(partById(await h.snapshot(), track)?.cells ?? []);

    await moveTo(h, hexCenter(ONWARD));
    await h.advance(1);
    const relaid = spelled(partById(await h.snapshot(), track)?.cells ?? []);

    await releasePointer(h);
    await h.advance(1);
    return { shortened, relaid };
  });

  assertDeepEqual(
    seen.shortened,
    spelled(PATH.slice(0, 2)),
    "the move back onto the cell behind the live end dropped the end cell",
  );
  assertDeepEqual(
    seen.relaid,
    spelled([...PATH.slice(0, 2), ONWARD]),
    "and the next hex was appended after that cell: it is the live end now",
  );
});
