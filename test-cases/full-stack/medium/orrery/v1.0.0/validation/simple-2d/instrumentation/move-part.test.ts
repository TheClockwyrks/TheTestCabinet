// instrumentation/move-part — `movePart` translates a whole part onto a new
// anchor, and changes nothing else about it.
//
// THE RULE. "`movePart(part, q, r)` | Translates the whole part, a track's path
// included, so its anchor is `(q, r)`" (`specs/instrumentation.md`, The machine).
// Which hex is a part's anchor is `specs/formats.md`'s: arms, wheels, sigils,
// rises and sets carry "`q`, `r`", while "A track carries no `q`, `r`, or
// `rotation`; its anchor is the first cell of `cells`". A sigil's shape follows
// its anchor, because "its footprint is its pattern's hexes placed at that pose"
// (`specs/parts.md`), and a track's path is rigid, because the whole part
// translates. Nothing else about a part is a translation's business: "Each pose
// sets one thing and leaves the rest of the game as it stands"
// (`specs/instrumentation.md`), and `specs/editor.md` says the same of a move made
// by hand — "Arms and wheels keep their tapes".
//
// WHERE A SIGIL'S FOOTPRINT IS READ. The snapshot reports a sigil's anchor rather
// than its hexes, and placement rule 2 is what makes those hexes observable
// through this same group of operations: "Sigil footprints... are pairwise
// disjoint" (`specs/parts.md`). So a one-hex sigil laid on the moved sigil's new
// second hex is refused, and one laid on the hex it vacated is placed.
//
// THE CONFIGURATION. Three parts, one of each shape the rule names: an arm at
// `(-3, 0)` at rotation `2`, length `3`, carrying a two-cell tape; a three-cell
// open track running east from `(0, 2)`; and a `bind`, whose footprint at
// rotation `0` is its anchor and the hex east of it, at `(0, 4)`. Each is then
// translated onto a new anchor, and nothing else is placed.
//
// THE VERDICT. The arm's anchor is the hex it was moved to, and its rotation, its
// length and its tape are exactly what they were. The track's path is its old
// path translated rigidly, in the same order, still open. The `bind`'s anchor is
// the hex it was moved to, and its footprint went with it: a sigil is refused on
// the hex east of its new anchor and placed on the hex east of its old one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertTrue,
} from "../assert";
import { at } from "../field";
import { armPart, sigilPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Whether a surface call refused: it threw rather than returning. */
async function refused(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call();
    return false;
  } catch {
    return true;
  }
}

it("translates an arm, a track's whole path and a sigil's whole footprint", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", -3, 0, 2, 3, ["grab", "rotate-cw"]),
      trackPart([at(0, 2), at(1, 2), at(2, 2)]),
      sigilPart("bind", 0, 4, 0),
    ]),
  );
  const placed = await partIds(h);
  const arm = placed[0] ?? -1;
  const track = placed[1] ?? -1;
  const bind = placed[2] ?? -1;

  await h.debug.movePart(arm, 1, -3);
  await h.debug.movePart(track, -2, -2);
  await h.debug.movePart(bind, -1, -4);
  await h.advance(1);
  await captureStill(h, "moved");
  const moved = await h.snapshot();

  assertNotNull(
    partById(moved, arm),
    "the machine still reports the moved arm",
  );
  assertEqual(
    partById(moved, arm)?.q,
    1,
    "the arm's anchor q is the one asked for",
  );
  assertEqual(
    partById(moved, arm)?.r,
    -3,
    "the arm's anchor r is the one asked for",
  );
  assertEqual(
    partById(moved, arm)?.rotation,
    2,
    "a translation leaves the arm's rotation as it stands",
  );
  assertEqual(
    partById(moved, arm)?.length,
    3,
    "a translation leaves the arm's length as it stands",
  );
  assertDeepEqual(
    partById(moved, arm)?.tape,
    ["grab", "rotate-cw"],
    "a translation leaves the arm's tape as it stands",
  );

  assertNotNull(
    partById(moved, track),
    "the machine still reports the moved track",
  );
  assertDeepEqual(
    (partById(moved, track)?.cells ?? []).map((cell) => `${cell.q},${cell.r}`),
    ["-2,-2", "-1,-2", "0,-2"],
    "the track's whole path travels rigidly, in order, so its first cell is the new anchor",
  );
  assertEqual(
    partById(moved, track)?.closed,
    false,
    "a translation leaves the track open, as it was laid",
  );

  assertEqual(
    partById(moved, bind)?.q,
    -1,
    "the sigil's anchor q is the one asked for",
  );
  assertEqual(
    partById(moved, bind)?.r,
    -4,
    "the sigil's anchor r is the one asked for",
  );
  assertTrue(
    await refused(() => h.debug.placePart("wane", 0, -4, 0)),
    "(0, -4) is the bind's second footprint hex at its NEW anchor, so a sigil there breaks rule 2",
  );
  await h.debug.placePart("wane", 1, 4, 0);
  assertEqual(
    (await h.snapshot()).editor.parts.length,
    4,
    "(1, 4), the bind's second footprint hex at its OLD anchor, is vacant, so a sigil there is placed",
  );
});
