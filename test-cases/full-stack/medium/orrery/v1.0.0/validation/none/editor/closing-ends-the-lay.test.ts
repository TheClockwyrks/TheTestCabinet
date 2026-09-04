// editor/closing-ends-the-lay — the close ends the lay at once, without waiting
// for the release.
//
// THE RULE. "Moving onto the path's other end closes the track into a loop and
// ends the lay" (`specs/editor.md`, Laying track), read against the drag shape
// `specs/instrumentation.md` reports: `editor.drag` is "the live drag", and it is
// `null` when there is none. So the close is what ends this lay, and a pointer
// move made after it belongs to no lay: "each pointer move retargets it" applies
// to a live drag alone, and there is none.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and one
// open three-cell track posed through the surface: `(0, 0)`, `(1, 0)`, `(0, 1)`,
// consecutive cells adjacent and the last adjacent to the first, so it may close.
// Nothing else is on the field. A press on the last cell opens the lay, a move
// onto `(0, 0)` closes it, and then — WITHOUT releasing — the pointer is moved
// onto `(-1, 1)`, which is adjacent to `(0, 1)`, the cell that was the live end,
// and is on no cell of the path. Under a live lay from the `last` end that hex
// would be appended; the rule says the lay is over, so nothing is.
//
// THE VERDICT. `editor.drag` is `null` the moment the path closes, and the move
// made after it appends nothing: the path still holds its three cells and the
// track is still closed. The release, when it finally comes, changes nothing that
// was already decided.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter, type Hex } from "../field";
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

/** The three cells laid, in order. */
const FIRST: Hex = at(0, 0);
const MIDDLE: Hex = at(1, 0);
const LAST: Hex = at(0, 1);

/** Adjacent to `LAST` by `DIRS[3]` and on no cell of the path: what a live lay would append. */
const BEYOND: Hex = at(-1, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the lay at the close, so a further move appends nothing", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [FIRST, MIDDLE, LAST]);

  const seen = await captureReplay(h, "ended", async () => {
    await h.advance(1);
    await pressAt(h, hexCenter(LAST));
    const opened = (await h.snapshot()).editor.drag;
    await h.advance(1);

    await moveTo(h, hexCenter(FIRST));
    const closed = await h.snapshot();
    await h.advance(1);

    await moveTo(h, hexCenter(BEYOND));
    const after = await h.snapshot();
    await h.advance(1);
    return { opened, closed, after };
  });
  await releasePointer(h);

  assertEqual(
    seen.opened?.kind,
    "lay",
    "the press on the last cell begins a lay, which is the lay the close must end",
  );
  assertEqual(
    partById(seen.closed, track)?.closed,
    true,
    "the move onto the other end closed the track, so this is the moment the rule is about",
  );
  assertNull(
    seen.closed.editor.drag,
    "editor.drag is null the moment the path closes, without waiting for the release",
  );

  assertNull(
    seen.after.editor.drag,
    "no lay is live after the close, so the further move retargets nothing",
  );
  const path = partById(seen.after, track);
  assertNotNull(path, "the track is still on the field after the further move");
  assertLength(
    path?.cells ?? [],
    3,
    "the move onto a hex adjacent to the old live end appends nothing, because the lay is over",
  );
  assertEqual(
    path?.closed,
    true,
    "the track stands closed, as the close left it",
  );
});
