// instructions/reset-walk-wraps-on-a-closed-track — the walk's track cell steps
// through a closed track's join, in both directions.
//
// THE RULE. "`advance` and `recede` step its track cell, wrapping only on a
// closed track and stopping at the end of an open one"
// (`specs/instructions.md`, The two macros). What wrapping means belongs to
// `specs/parts.md`: "The `advance` instruction carries a mounted arm's base to
// the next cell of the path and `recede` to the previous one; on a closed track
// both wrap between the ends". A track is closed "when its last cell is adjacent
// to its first and the editor has joined them into a loop", and mounting is
// positional: "An arm or wheel whose anchor hex is a cell of a track is mounted
// on that track".
//
// THE CONFIGURATION. One challenge open in the editor, an empty machine, and one
// CLOSED six-cell track — the ring of hexes around `(0, 0)`, whose consecutive
// cells are adjacent and whose last cell is adjacent to its first, so
// `specs/parts.md`'s sixth placement rule holds — with two arms anchored on it.
// One arm sits on the track's LAST cell and carries `advance`; the other sits on
// its FIRST cell and carries `recede`. Those are the two steps that can only be
// taken through the join. Nothing else is placed, no run is started, and the
// focus is posed to `tape` with the cursor at column `1` on each row in turn, so
// each walk reads exactly its own one cell.
//
// WHAT THE READINGS DISAGREE ON. Wrapping, the first arm's walk stands on cell
// `0` while its rest cell is `5`, and the return run is the ONE `recede` that is
// the shorter way back around the loop; the second arm's walk stands on cell `5`
// while its rest cell is `0`, and the return run is one `advance`. Not wrapping,
// each walk would still be standing on its own rest cell and each expansion would
// be `drop` alone — "An arm already at rest writes `drop` alone" — so the two
// builds are separated by whether anything follows the `drop` at all, in both
// directions.
//
// THE VERDICT. The arm on the last cell is answered `drop`, `recede`; the arm on
// the first cell is answered `drop`, `advance`; and each keeps the cell before
// its cursor.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at, type Hex } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
} from "../harness";

/** The ring around (0, 0): six cells, each adjacent to the next and the last to the first. */
const RING: readonly Hex[] = [
  at(1, 0),
  at(0, 1),
  at(-1, 1),
  at(-1, 0),
  at(0, -1),
  at(1, -1),
];

/** The arm on the LAST cell, whose advance can only leave through the join. */
const LAST = RING[RING.length - 1] ?? at(0, 0);

/** The arm on the FIRST cell, whose recede can only leave through the join. */
const FIRST = RING[0] ?? at(0, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries the walk through a closed track's join, advancing and receding", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  await loadMachine(
    h,
    solution([
      trackPart(RING, true),
      armPart("arm", LAST.q, LAST.r, 0, 1, ["advance"]),
      armPart("arm", FIRST.q, FIRST.r, 0, 1, ["recede"]),
    ]),
  );
  const [track = -1, onLast = -1, onFirst = -1] = await partIds(h);

  const placed = partById(await h.snapshot(), track);
  assertNotNull(placed, "the track is on the machine");
  assertEqual(placed?.closed, true, "the six-cell track is closed into a loop");
  assertEqual(
    placed?.cells?.length,
    RING.length,
    "the track carries all six cells of the ring",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(onLast, 1);
  await pressAction(h, "ins-reset");
  await h.debug.setCursor(onFirst, 1);
  await pressAction(h, "ins-reset");
  await captureStill(h, "closed-wrap");

  const written = await h.snapshot();
  assertDeepEqual(
    partById(written, onLast)?.tape,
    ["advance", "drop", "recede"],
    "advance at the last cell carried the walk to the first cell of the path, and reset runs the one step back through the join",
  );
  assertDeepEqual(
    partById(written, onFirst)?.tape,
    ["recede", "drop", "advance"],
    "recede at the first cell carried the walk to the last cell of the path, and reset runs the one step back through the join",
  );
});
