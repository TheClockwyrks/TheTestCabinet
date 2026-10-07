// editor/a-one-cell-track-lays-from-its-last-end — a press on a one-cell track
// opens a lay from its `last` end.
//
// THE RULE. "A press on a one-cell track begins laying from its `last` end"
// (`specs/editor.md`, Laying track), which settles the case the sentence above it
// leaves ambiguous — "A press on an end cell of an open track begins laying rather
// than moving" — because on a path of one cell that single hex is both ends.
// `specs/parts.md` licenses the configuration: "A track of one cell is legal and
// open."
//
// What a press opens is read off `editor.drag`, whose three shapes
// `specs/instrumentation.md` fixes: a lay is `{ kind: "lay", part: <part id>, end:
// "first" | "last" }`, and a move is `{ kind: "move", part, from, at }`. So the
// three answers this point tells apart — a lay from `last`, a lay from `first`,
// and a move — are all readable off that one field.
//
// THE CONFIGURATION. `BARE` opened in the editor, the machine cleared, and a
// single one-cell track posed on `(0, 0)` through the surface. Nothing else is on
// the field, so the hex the press targets carries exactly this track and the press
// can take nothing else. The press lands on that cell's centre, which
// `specs/field.md`'s targeting rule resolves to `(0, 0)`.
//
// THE VERDICT. `editor.drag` is a lay, it names this track, and its `end` is
// `last`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placeTrack,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a lay whose end is last on a track of a single cell", async () => {
  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, [ORIGIN]);

  await pressAt(h, hexCenter(ORIGIN));
  await h.advance(1);
  await captureStill(h, "lay");
  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  assertNotNull(drag, "the press on the track's only cell opens a drag");
  assertEqual(
    drag?.kind,
    "lay",
    "a press on a one-cell track begins laying rather than moving",
  );
  assertEqual(
    drag?.kind === "lay" ? drag.part : null,
    track,
    "the lay names the track that was pressed",
  );
  assertEqual(
    drag?.kind === "lay" ? drag.end : null,
    "last",
    "a one-cell track lays from its last end",
  );
});
