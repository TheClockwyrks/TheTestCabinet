// editor/a-press-on-a-closed-track-opens-a-move — every cell of a closed track
// opens a move drag.
//
// THE RULE. "A press on any cell of a closed track begins a move"
// (`specs/editor.md`, Laying track). The sentences above it start a lay at "an end
// cell of an open track", and a closed track has no end to lay from: rule 6 of
// `specs/parts.md` joins its last cell to its first. So what a press on a closed
// track begins is the general field gesture instead — "From the field: a press on
// a part selects it at once and begins a move" (`specs/editor.md`, Dragging).
//
// `specs/instrumentation.md` fixes the shape that answers this: a move is
// `{ kind: "move", part: <part id>, from: { q, r }, at: { q, r } | null }`, and a
// lay is `{ kind: "lay", part, end }`, so the two are told apart by `kind` alone.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and the
// closed three-cell track of `CLOSED_TRACK` loaded: `(0, 0)`, `(1, 0)`, `(0, 1)`
// with `closed` `true` — "the shortest a closed one may be", exactly rule 6's
// minimum. Nothing else is on the field, so each press targets a cell of this
// track and nothing else. All THREE cells are pressed in turn, because "any cell"
// is what the rule says and the two that would be the ends of the open path are
// the ones a build gets wrong; each press is released before the next, so the
// drag read after a press is that press's own.
//
// THE VERDICT. Every press opens a drag of kind `move` naming this track. None of
// them opens a lay.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { at, hexCenter, type Hex } from "../field";
import { BARE, CLOSED_TRACK } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partIds,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

/** The three cells of `CLOSED_TRACK`, which is the loop this point presses. */
const CELLS: readonly Hex[] = [at(0, 0), at(1, 0), at(0, 1)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a move drag naming the track, whichever of its cells is pressed", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, CLOSED_TRACK);
  const track = (await partIds(h))[0] ?? -1;

  const posed = (await h.snapshot()).editor.parts[0];
  assertEqual(
    posed?.closed,
    true,
    "the posed track is closed, which is the case the rule is about",
  );

  for (const cell of CELLS) {
    await pressAt(h, hexCenter(cell));
    await h.advance(1);
    await captureStill(h, "move");
    const drag = (await h.snapshot()).editor.drag;
    await releasePointer(h);

    assertNotNull(drag, `the press on (${cell.q}, ${cell.r}) opens a drag`);
    assertEqual(
      drag?.kind,
      "move",
      `a press on cell (${cell.q}, ${cell.r}) of a closed track begins a move, because a closed track has no end to lay from`,
    );
    assertEqual(
      drag?.kind === "move" ? drag.part : null,
      track,
      `the move names the closed track the press landed on`,
    );
  }
});
