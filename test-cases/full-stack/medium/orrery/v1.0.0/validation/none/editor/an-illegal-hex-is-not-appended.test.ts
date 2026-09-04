// editor/an-illegal-hex-is-not-appended — while laying, a hex adjacent to the live
// end that the placement rules refuse is not appended, and the lay stays live.
//
// THE RULE. "While laying, moving the pointer onto a hex adjacent to the live end
// appends it to the path WHEN THE PLACEMENT RULES ALLOW, and that hex becomes the
// live end" (`specs/editor.md`, Laying track). The rules are `specs/parts.md`'s
// six, and the one this check leans on is rule 3: "NO HEX IS A CELL OF TWO
// TRACKS, or of one track twice." The lay itself is not ended by a hex it cannot
// take: "The RELEASE ends the lay, leaving the path as laid", and no release has
// happened yet.
//
// THE CONFIGURATION. `BARE` opened in the editor with TWO tracks laid through the
// surface: the one being laid, `(0, 0)`–`(1, 0)`, and a one-cell track sitting on
// `(2, 0)`. `(2, 0)` is adjacent to the live end `(1, 0)` — `specs/field.md`, "Two
// hexes are adjacent when their difference is one of `DIRS`" — and on the field,
// so adjacency and rule 1 are both satisfied and rule 3 is the only thing that can
// refuse it. The placement oracle names rule 3 before the gesture.
//
// AND THE LAY REALLY WAS LAYING. A refusal that a build satisfies by appending
// NOTHING EVER would decide nothing, so after the refused move the pointer steps
// onto `(1, -1)` — adjacent to the same live end, on the field, and a cell of
// nothing — and that hex must be appended.
//
// THE VERDICT. After the move onto `(2, 0)` the path is still `(0, 0)`, `(1, 0)`
// and `editor.drag` is still a `lay`; after the move onto `(1, -1)` the path is
// `(0, 0)`, `(1, 0)`, `(1, -1)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { adjacent, at, hexCenter, type Hex } from "../field";
import { trackPart } from "../formats";
import { BARE } from "../fixtures";
import { placementFault } from "../parts";
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

/** The path being laid, and the cell its lay is opened from. */
const PATH: readonly Hex[] = [at(0, 0), at(1, 0)];

/** The live end the two moves below are measured against. */
const LIVE: Hex = PATH[PATH.length - 1] as Hex;

/** A cell of the OTHER track: adjacent to the live end, and refused by rule 3. */
const TAKEN: Hex = at(2, 0);

/** A bare hex, adjacent to the same live end, that the rules do allow. */
const FREE: Hex = at(1, -1);

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

it("leaves the path as it stands and keeps the lay live", async () => {
  const patterns = { reagents: BARE.reagents, products: BARE.products };
  assertTrue(adjacent(LIVE, TAKEN), "the refused hex is adjacent to the live end");
  assertTrue(adjacent(LIVE, FREE), "and so is the hex that follows it");
  assertEqual(
    placementFault([trackPart([...PATH, TAKEN]), trackPart([TAKEN])], patterns)
      ?.rule,
    3,
    "appending (2, 0) would make it a cell of two tracks, which rule 3 refuses",
  );
  assertEqual(
    placementFault([trackPart([...PATH, FREE]), trackPart([TAKEN])], patterns),
    null,
    "appending (1, -1) instead breaks none of the six rules",
  );

  await openChallengeDocument(h, BARE);
  const laying = await placeTrack(h, PATH);
  await placeTrack(h, [TAKEN]);

  const seen = await captureReplay(h, "refused", async () => {
    await h.advance(1);
    await pressAt(h, hexCenter(LIVE));

    await moveTo(h, hexCenter(TAKEN));
    await h.advance(1);
    const snapshot = await h.snapshot();
    const refused = {
      cells: spelled(partById(snapshot, laying)?.cells ?? []),
      kind: snapshot.editor.drag?.kind ?? null,
    };

    await moveTo(h, hexCenter(FREE));
    await h.advance(1);
    const appended = spelled(partById(await h.snapshot(), laying)?.cells ?? []);

    await releasePointer(h);
    await h.advance(1);
    return { refused, appended };
  });

  assertDeepEqual(
    seen.refused.cells,
    spelled(PATH),
    "the move onto a hex rule 3 refuses left the path exactly as it stood",
  );
  assertEqual(
    seen.refused.kind,
    "lay",
    "and the lay is still live: only the release ends one",
  );
  assertDeepEqual(
    seen.appended,
    spelled([...PATH, FREE]),
    "the very next move, onto a hex the rules allow, appended it: the lay was laying all along",
  );
});
