// maze/symmetry — mirror-symmetric about the centerline.
//
// `specs/maze.md`, under "A conforming maze": "Mirror symmetry. Column `c` and
// column `GRID_COLS - 1 - c` carry the same kind of tile in every row: rock
// mirrors rock, and a tile that is not rock mirrors a tile that is not rock. The
// axis of that mirror runs between columns `17` and `18`. A pair is exempt when
// either of its two tiles is den interior or the den gate."
//
// Two things the rule does NOT say, and this check does not assert. It does not
// ask a corridor to mirror a corridor: `.`, `d` and `g` are all "not rock", so a
// build is free to differ between them across the axis. And it fixes the axis by
// the grid's own width, so the mirror of column `c` is read off the frame the
// build reports rather than off a hard `35 - c` — a board of the wrong size is
// the grid point's verdict, not this one's.
//
// THE DEN IS EXEMPT, AND THAT IS THE WHOLE REASON THE RULE HAS AN EXEMPTION: the
// chamber's one gate sits on one side of the axis and has no partner on the
// other. Every pair with a `d` or a `g` on either side is left out of the tally.
//
// THE BOARD IS THE BUILD'S OWN, over several freshly laid-out layouts, because
// finding the property in a board a build invented IS the check.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { symmetryMismatches } from "../maze";
import { captureBoard, freshBoards, requireLaidOut, witness } from "./boards";

/**
 * How many cells may disagree with their mirror about being rock.
 *
 * None: `specs/maze.md` states the rule "in every row", so a conforming layout
 * carries no mismatched pair at all. Each cell of a disagreeing pair is counted,
 * so the only figure this reading can be asserted against is zero.
 */
const MAX_MISMATCHES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lays out a maze that mirrors about the axis between columns 17 and 18", async () => {
  const boards = await freshBoards(h);
  requireLaidOut(boards);

  const measured = boards.map((board) => {
    const mismatches = symmetryMismatches(board.snapshot);
    return { board, mismatches, ok: mismatches === MAX_MISMATCHES };
  });
  await captureBoard(h, witness(measured).board);

  for (const one of measured) {
    assertEqual(
      one.mismatches,
      MAX_MISMATCHES,
      `cells that disagree with their mirror about being rock, den interior and ` +
        `den gate exempt, in maze ${one.board.ordinal} the game laid out`,
    );
  }
});
