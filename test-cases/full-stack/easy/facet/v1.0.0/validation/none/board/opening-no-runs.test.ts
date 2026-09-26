// Facet — board/opening-no-runs: the board a round opens on holds no maximal run
// under R4.
//
// WHAT THE SPECIFICATION ASKS FOR. specs/rules.md gives an opening board two
// properties, and this is the first: "it holds no run under R4". specs/
// instrumentation.md repeats it of `dealBoard`, which deals the board "through
// the game's own code, so it holds no run under R4". A deal is drawn at random
// from `GEM_KINDS`, so a run turns up on a raw 8x8 draw often; a build has to look at
// what it drew and do something about it, and the ones that do not are the ones
// this point catches. A round that opens on a standing run either resolves it
// before the player has moved, or leaves free points lying on the board.
//
// HOW IT IS READ. R4 is applied here rather than asked of the build:
// `maximalRuns` walks every row and every column of the dealt board as a
// sequence of same-kind stretches and reports each stretch of `MATCH_MIN` or
// more, so what is checked is the specification's rule over the board the build
// actually dealt. A prism belongs to no kind and joins no run, which costs
// nothing on an opening board — `board/opening-plain-and-clean` is where the
// cuts of a deal are read.
//
// WHY SEVERAL DEALS. One deal proves nothing: a build that never checks its deal
// still passes when the draw happens to come out clean. A round from the title
// is a `reset` followed by the harness's `startRound`, which deals through the
// build's own `dealBoard`, so the sweep below opens a fresh round several times
// over. Nothing is asserted about any particular deal — it is the property that
// must hold of every board the build deals.

import { afterEach, beforeEach, it } from "vitest";
import { maximalRuns } from "../board";
import { assertEqual, assertLength, fail } from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  startRound,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * How many rounds are dealt.
 *
 * One deal proves nothing: a build that never checks its deal still passes when
 * the draw happens to come out right. Each deal here is a fresh draw off the
 * build's own random source, nothing is asserted about any particular one, and
 * the property under test has to hold of all of them.
 */
const DEALS = 8;

let h: Harness;

/** Open a fresh round from the title, which deals a fresh opening board. */
async function deal(): Promise<FacetSnapshot> {
  await h.debug.reset();
  return startRound(h);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals an opening board with no maximal run on it, deal after deal", async () => {
  for (let deal_ = 1; deal_ <= DEALS; deal_ += 1) {
    const opened = await deal();

    // The deal has to be a whole board before R4 can be read over it: a board
    // reported short would otherwise pass for want of anything to find a run in.
    assertEqual(opened.screen, "playing", `screen of deal ${deal_}`);
    assertLength(
      opened.board.cells,
      GRID_COLS * GRID_ROWS,
      `cells of deal ${deal_}`,
    );

    const rows = await h.board();
    const runs = maximalRuns(rows);
    if (runs.length > 0) {
      // Named rather than counted: the failure says which gems, of which kind,
      // on which cells, and shows the whole board they were found on.
      const run = runs[0];
      const cells = run.cells
        .map((cell) => `(${cell.col},${cell.row})`)
        .join(" ");
      fail(
        `no maximal run on the board of deal ${deal_} — ` +
          rows.map((row) => row.trim()).join(" | "),
        `${runs.length} run(s), the first ${run.cells.length} ${run.kind} at ${cells}`,
      );
    }

    // The evidence is one deal's worth: a frame is run so the canvas holds the
    // board that was just dealt rather than the title screen behind it.
    if (deal_ === 1) {
      await h.advance(1);
      await captureStill(h, "deal");
    }
  }
});
