// parts/adjacent-ends-stay-open-until-joined — adjacency alone does not close a
// track; the join does.
//
// THE RULE. "A track is `closed` when its last cell is adjacent to its first AND
// the editor has joined them into a loop, as `specs/editor.md` describes;
// otherwise it is open" (`specs/parts.md`, Track — emphasis on the conjunction,
// which is the whole of this point). `specs/editor.md` describes the join under
// Laying track: "Moving onto the path's other end closes the track into a loop and
// ends the lay", and `specs/instrumentation.md` gives the operation that does the
// same thing: "`closeTrack(part)` — Joins that track's last cell to its first,
// exactly as closing a path in `specs/editor.md` does."
//
// THE CONFIGURATION. A three-cell path `(0, 0)`, `(1, 0)`, `(0, 1)`, laid one hex
// at a time and never joined. Its consecutive cells are adjacent, as placement
// rule 6 requires, and its last cell `(0, 1)` IS adjacent to its first `(0, 0)` —
// their difference is `DIRS[1]` — so the geometric half of the closing condition
// already holds. Three cells is also the fewest a closed track may have, "a closed
// track's ... path holds at least three cells" (placement rule 6), so nothing but
// the missing join can be why it is open. Nothing else is placed and no run is
// live: laying a path is an editor act.
//
// THE VERDICT. While unjoined the track reports `closed` `false` on a path whose
// ends touch. The join is then made, and the same track reports `closed` `true`
// over the same three cells — which is what makes the first reading the rule
// rather than a build that never closes anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import { adjacent, at, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placeTrack,
  type Harness,
} from "../harness";

/** A path whose last cell touches its first, laid but never joined. */
const CELLS: readonly Hex[] = [at(0, 0), at(1, 0), at(0, 1)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports closed false on a path whose ends touch, and true once joined", async () => {
  // The geometry the check claims to be posing: the ends are adjacent already.
  const first = CELLS[0] as Hex;
  const last = CELLS[CELLS.length - 1] as Hex;
  assertTrue(
    adjacent(last, first),
    "the path's last cell is adjacent to its first, so only the join is missing",
  );

  await openChallengeDocument(h, BARE);
  const track = await placeTrack(h, CELLS);

  await h.advance(1);
  const open = await h.snapshot();
  await captureStill(h, "open");

  const laid = partById(open, track);
  assertNotNull(laid, "the laid track is on the machine");
  assertEqual(
    laid?.cells?.length,
    CELLS.length,
    "the whole path was laid, one cell at a time",
  );
  assertEqual(
    (laid?.cells ?? []).map((cell) => `${cell.q},${cell.r}`).join(" "),
    CELLS.map((cell) => `${cell.q},${cell.r}`).join(" "),
    "the path holds the cells it was laid through, in order",
  );
  assertEqual(
    laid?.closed,
    false,
    "adjacent ends alone leave the track OPEN: closing needs the editor's join",
  );

  await h.debug.closeTrack(track);
  const joined = partById(await h.snapshot(), track);
  assertEqual(
    joined?.closed,
    true,
    "the same track reports closed once its ends have been joined into a loop",
  );
  assertEqual(
    joined?.cells?.length,
    CELLS.length,
    "the join changed the flag rather than the path",
  );
});
