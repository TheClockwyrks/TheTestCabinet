// editor/a-non-adjacent-hex-is-not-appended — while laying, a hex two or more steps
// from the live end is not appended.
//
// THE RULE. "While laying, moving the pointer ONTO A HEX ADJACENT TO THE LIVE END
// appends it to the path when the placement rules allow" (`specs/editor.md`,
// Laying track). Adjacency alone is what a move is offered, and `specs/parts.md`
// requires it of the result too: "A `track` is an ordered path of distinct hexes,
// `cells`... CONSECUTIVE CELLS ARE ADJACENT", which placement rule 6 restates. So
// a hex two steps away is not a hex the path can take. Adjacency is
// `specs/field.md`'s: "Two hexes are adjacent when their difference is one of
// `DIRS`."
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE one-cell track on
// `ORIGIN`, laid through the surface, and nothing else on the field — so the hex
// the pointer jumps to is on the field, is a cell of nothing, and lies on no
// footprint, and ADJACENCY is the only rule that can refuse it. "A press on a
// one-cell track begins laying from its `last` end", so the live end is `ORIGIN`.
// The pointer jumps to `(2, 0)`, two steps east.
//
// AND THE LAY REALLY WAS LAYING. A build that appends nothing ever would satisfy a
// check that only reads a refusal, so after the jump the pointer steps onto
// `(1, 0)` — one step from the same live end — and that hex must be appended.
//
// THE VERDICT. After the move onto `(2, 0)` the path is still `ORIGIN` alone;
// after the move onto `(1, 0)` it is `(0, 0)`, `(1, 0)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertTrue } from "../assert";
import { adjacent, at, hexCenter, type Hex } from "../field";
import { BARE, ORIGIN } from "../fixtures";
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

/** Two steps east of the live end: not adjacent to it. */
const DISTANT: Hex = at(2, 0);

/** One step east of the same live end: adjacent to it. */
const NEAR: Hex = at(1, 0);

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

it("leaves the path as it stands when the pointer skips a hex", async () => {
  assertTrue(
    !adjacent(ORIGIN, DISTANT),
    "the hex the pointer jumps to is two steps from the live end, not one",
  );
  assertTrue(
    adjacent(ORIGIN, NEAR),
    "and the hex it steps to afterwards is one",
  );

  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [ORIGIN]);

  const seen = await captureReplay(h, "skipped", async () => {
    await h.advance(1);
    await pressAt(h, hexCenter(ORIGIN));

    await moveTo(h, hexCenter(DISTANT));
    await h.advance(1);
    const skipped = spelled(partById(await h.snapshot(), track)?.cells ?? []);

    await moveTo(h, hexCenter(NEAR));
    await h.advance(1);
    const appended = spelled(partById(await h.snapshot(), track)?.cells ?? []);

    await releasePointer(h);
    await h.advance(1);
    return { skipped, appended };
  });

  assertDeepEqual(
    seen.skipped,
    spelled([ORIGIN]),
    "the move onto a hex two steps away appended nothing: the path is the cell it was",
  );
  assertDeepEqual(
    seen.appended,
    spelled([ORIGIN, NEAR]),
    "the very next move, onto a hex adjacent to the live end, appended it",
  );
});
