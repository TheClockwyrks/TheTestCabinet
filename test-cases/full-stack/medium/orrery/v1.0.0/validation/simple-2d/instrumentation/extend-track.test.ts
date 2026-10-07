// instrumentation/extend-track — `extendTrack` appends a cell at the track's last
// end.
//
// THE RULE. "`extendTrack(part, q, r)` | Appends `(q, r)` to that track's path at
// its `last` end" (`specs/instrumentation.md`, The machine). The path is ordered:
// "A `track` is an ordered path of distinct hexes, `cells`, laid one hex at a
// time in the editor. Consecutive cells are adjacent" (`specs/parts.md`, Track),
// and the snapshot reports it as "`cells: [{ q, r }]`" in that order
// (`specs/instrumentation.md`, Snapshot shape). What the extension puts on the
// field has to be visible there: "A track's path reads as a path, with its two
// ends visible while it is open" (`specs/parts.md`, Presentation).
//
// THE CONFIGURATION. A challenge open in the editor with an empty machine, one
// one-cell track seeded on `(0, 0)`, and two extensions: onto `(1, 0)`, adjacent
// to it, and then onto `(1, 1)`, adjacent to THAT. Nothing else is placed, so the
// hex the second extension reaches is bare until the call that reaches it.
//
// THE VERDICT. After the first call the path is `(0, 0)`, `(1, 0)` in that order;
// after the second it is `(0, 0)`, `(1, 0)`, `(1, 1)` — each new cell appended at
// the last end rather than in front or in the middle. And the frame drawn after
// the second call differs, inside the new cell, from the frame drawn before it:
// the path now reaches a hex it did not reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertNotNull } from "../assert";
import { HEX_PITCH } from "../constants";
import { at, hexCenter } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  pixelsDiffering,
  placeTrack,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The cells of `part`, as `"q,r"` in the order the snapshot reports them. */
function cellsOf(
  snapshot: Awaited<ReturnType<Harness["snapshot"]>>,
  part: number,
): string[] {
  return (partById(snapshot, part)?.cells ?? []).map(
    (cell) => `${cell.q},${cell.r}`,
  );
}

it("appends each new cell at the track's last end", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);

  const track = await placeTrack(h, [at(0, 0)]);
  await h.debug.extendTrack(track, 1, 0);
  const afterFirst = await h.snapshot();

  // The picture inside the hex the SECOND extension will reach, before it does.
  const reached = hexCenter(at(1, 1));
  const span = HEX_PITCH / 2;
  await h.advance(1);
  const before = await h.pixelRect(
    reached.x - span / 2,
    reached.y - span / 2,
    span,
    span,
  );

  await h.debug.extendTrack(track, 1, 1);
  await h.advance(1);
  await captureStill(h, "extended");
  const after = await h.pixelRect(
    reached.x - span / 2,
    reached.y - span / 2,
    span,
    span,
  );
  const afterSecond = await h.snapshot();

  assertNotNull(
    partById(afterFirst, track),
    "the machine still reports the track after the first extension",
  );
  assertDeepEqual(
    cellsOf(afterFirst, track),
    ["0,0", "1,0"],
    "the first extension appends (1, 0) after the seed cell",
  );
  assertDeepEqual(
    cellsOf(afterSecond, track),
    ["0,0", "1,0", "1,1"],
    "the second extension appends (1, 1) at the last end, so the path grows in order",
  );
  assertGreaterThan(
    pixelsDiffering(before, after),
    0,
    "the drawn path reaches the new cell: the frame differs inside (1, 1)",
  );
});
