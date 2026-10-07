// Facet — screens/start-round-from-title: PLAY opens a fresh round.
//
// specs/ui.md gives the title menu's `PLAY` its effect — "Starts a fresh round,
// as specs/rules.md describes, and sets `screen = playing`" — and adds the part
// this point is really about: "A round started from here is always fresh,
// whatever was played before it, so the score, the level, and the board a player
// is handed carry nothing over from an earlier round."
//
// PLAY AGAIN IS A POINT OF ITS OWN. specs/ui.md gives the game-over menu its own
// entry with the same effect, and a build can wire one of the two and not the
// other, so each entry is decided separately.
//
// THE ROUND HAS TO CLEAR SOMETHING. A round opened on a game that has banked
// nothing would pass on a build that carries every figure over, so the figures a
// fresh round must not be handed are POSED first, through the single-field
// operations specs/instrumentation.md gives for exactly that. Every zero
// asserted below is then known to be the round clearing something rather than a
// field that was never touched. The two bests are posed above anything a chain
// could have reached, so a build that merely failed to raise them is not
// mistaken here for one that cleared them.
//
// specs/ui.md has no board in play on the title, so what is posed here is the
// round's figures alone.
//
// PLAY IS REALLY CHOSEN. The highlight is posed onto it — `setMenuIndex` takes
// no item, so a build whose `up` and `down` never worked is still asked this
// question — and `confirm` is what takes it, through the key specs/controls.md
// binds and the build's own input path. Nothing here depends on where the entry
// sits in its menu; the ordering is the menu's own point.
//
// The board is asserted as a board IN PLAY — the full GRID_COLS x GRID_ROWS
// specs/board.md fixes, rather than the `{ cols: 0, rows: 0, cells: [] }` that
// specs/instrumentation.md says stands while no board is in play. What that
// dealt board must contain — no run, a legal swap, plain and clean gems, and a
// fall from above the board — is specs/rules.md's opening deal, and each of
// those is a point of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRID_COLS, GRID_ROWS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  takeMenuItem,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * The residue of a played round: figures no fresh round may be handed.
 *
 * Each is posed rather than earned, so what the round has to clear away is a
 * known figure. The two bests are posed ABOVE anything a chain could have
 * reached — a chain of one step leaves `bestChain` at `1` — so a build that
 * merely failed to raise them is not mistaken here for one that cleared them.
 */
const PLAYED_SCORE = 4321;
const PLAYED_LEVEL = 3;
const PLAYED_LEVEL_SCORE = 777;
const PLAYED_BEST_CHAIN = 6;
const PLAYED_BEST_MOVE = 890;
const PLAYED_MOVE_SCORE = 210;

/** Where `PLAY` sits on the title menu, from specs/ui.md's `TITLE_ITEMS`. */
const PLAY_INDEX = TITLE_ITEMS.indexOf("PLAY");

let h: Harness;

/** Every field the item names for a round's opening, read off one snapshot. */
function assertFreshRound(round: FacetSnapshot): void {
  assertEqual(round.screen, "playing", "the screen a round opens on");
  assertEqual(round.score, 0, "score");
  assertEqual(round.level, 1, "level");
  assertEqual(round.levelScore, 0, "levelScore");
  // The three figures specs/rules.md returns to 0 when a round starts.
  assertEqual(round.moveScore, 0, "moveScore");
  assertEqual(round.bestMove, 0, "bestMove");
  assertEqual(round.bestChain, 0, "bestChain");
  assertEqual(round.phase, "idle", "phase");
  assertEqual(round.chainStep, 0, "chainStep");
  assertEqual(round.menuIndex, 0, "menuIndex");
  assertEqual(round.selection, null, "selection");
  assertEqual(round.offer, null, "offer");
  assertEqual(round.refusal, null, "refusal");
  // A board is in play, and it is the whole board specs/board.md fixes.
  assertEqual(round.board.cols, GRID_COLS, "the dealt board's columns");
  assertEqual(round.board.rows, GRID_ROWS, "the dealt board's rows");
  assertLength(
    round.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells on the dealt board",
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh round when PLAY is taken from the title", async () => {
  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen PLAY is taken from",
  );

  // The figures a round must not be handed, standing before it opens.
  await h.debug.setScore(PLAYED_SCORE);
  await h.debug.setLevel(PLAYED_LEVEL);
  await h.debug.setLevelScore(PLAYED_LEVEL_SCORE);
  await h.debug.setBestChain(PLAYED_BEST_CHAIN);
  await h.debug.setBestMove(PLAYED_BEST_MOVE);
  await h.debug.setMoveScore(PLAYED_MOVE_SCORE);

  const standing = await h.snapshot();
  assertEqual(standing.score, PLAYED_SCORE, "the score standing on the title");
  assertEqual(standing.level, PLAYED_LEVEL, "the level standing on the title");
  assertEqual(
    standing.levelScore,
    PLAYED_LEVEL_SCORE,
    "the level score standing on the title",
  );
  assertEqual(
    standing.bestChain,
    PLAYED_BEST_CHAIN,
    "the best chain standing on the title",
  );
  assertEqual(
    standing.bestMove,
    PLAYED_BEST_MOVE,
    "the best move standing on the title",
  );
  assertEqual(
    standing.moveScore,
    PLAYED_MOVE_SCORE,
    "the move score standing on the title",
  );

  await takeMenuItem(h, PLAY_INDEX);
  await captureStill(h, "round");
  assertFreshRound(await h.snapshot());
});
