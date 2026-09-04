// Facet — screens/start-round: PLAY, and PLAY AGAIN, open a fresh round.
//
// specs/ui.md gives `PLAY` on the title and `PLAY AGAIN` on gameover the same
// effect — "Starts a fresh round, as specs/rules.md describes, and sets
// `screen = playing`" — and adds the part this point is really about: "A round
// started from here is always fresh, whatever was played before it, so the
// score, the level, and the board a player is handed carry nothing over from an
// earlier round."
//
// THE POSE IS THE ROUTE, AND IT COVERS BOTH ENTRIES. specs/instrumentation.md
// defines `start()` as "the choice of PLAY from the title menu, which is the
// same choice PLAY AGAIN makes from gameover" and then lists exactly the state
// a round opens in. So one pose decides both menu entries, and nothing here
// depends on where either entry sits in its menu — the ordering is the menus'
// own point, not this one. The pose is taken from each of the two screens in
// turn, because the sentence is about both.
//
// TWO ROUNDS, AND THE SECOND IS THE ONE THAT DECIDES IT. The first `start()`
// opens from a game that has played nothing, which a build carrying state over
// would still pass. So a round is then really played — a swap accepted, a chain
// resolved, and the round driven to its end — and the figures it left are posed
// higher still through the operations specs/instrumentation.md gives for exactly
// that, so every zero asserted on the second round is known to be the fresh
// round clearing something rather than a field that was never touched. Every field is
// asserted the same way both times, by the same helper, because "fresh" has to
// mean the same thing on the second round as on the first.
//
// THE THREE FIGURES A LEVEL IS MEASURED BY ARE IN THE LIST. specs/rules.md has
// `moveScore`, `bestMove` and `bestChain` return to `0` "when a level is opened
// and when a round starts, so each level is measured on its own" — so a round
// played after another must be measured from zero, and a build that carried a
// previous round's best move into a new one reports a figure no move of this
// round earned.
//
// HOW THE FIRST ROUND IS ENDED. specs/rules.md ends a round "when `phase`
// returns to `idle` and no legal swap exists on the board", so a chain is opened
// with an accepted swap and the board that chain will next be read against is
// written under it with `setGem`, which specs/instrumentation.md says leaves the
// screen, the phase and the selection where they were. `deadBoard()` carries no
// run under R4 and no adjacent exchange R1 and R3 both accept — both asserted
// here rather than assumed — so once the step's hold is spent the board seeds
// nothing, the chain returns to idle, and the round is over.
//
// The board is asserted as a board IN PLAY — the full GRID_COLS x GRID_ROWS
// specs/board.md fixes, rather than the `{ cols: 0, rows: 0, cells: [] }` that
// specs/instrumentation.md says stands while no board is in play. What that
// dealt board must contain — no run, a legal swap, plain and clean gems, and a
// fall from above the board — is specs/rules.md's opening deal, and each of
// those is a point of its own.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  GAMEOVER_ITEMS,
  GRID_COLS,
  GRID_ROWS,
  TITLE_ITEMS,
} from "../constants";
import {
  deadBoard,
  legalSwaps,
  maximalRuns,
  quietRowsWith,
  swapIsLegal,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
  takeMenuItem,
  writeBoard,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/** Three rubies across row 4, parted by the amethyst the swap trades out. */
const TRIGGER: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/**
 * The residue of a played round: figures no fresh round may be handed.
 *
 * Each is posed rather than earned, so what the second round has to clear away
 * is a known figure. The two bests are posed ABOVE anything the chain could have
 * reached — a chain of one step leaves `bestChain` at `1` — so a build that
 * merely failed to raise them is not mistaken here for one that cleared them.
 */
const PLAYED_SCORE = 4321;
const PLAYED_LEVEL = 3;
const PLAYED_LEVEL_SCORE = 777;
const PLAYED_BEST_CHAIN = 6;
const PLAYED_BEST_MOVE = 890;
const PLAYED_SELECTION: CellRef = { col: 2, row: 3 };
const PLAYED_OFFER: CellRef = { col: 3, row: 3 };

/** Where `PLAY` sits on the title menu, from specs/ui.md's `TITLE_ITEMS`. */
const PLAY_INDEX = TITLE_ITEMS.indexOf("PLAY");

/** Where `PLAY AGAIN` sits on the game-over menu, from specs/ui.md's `GAMEOVER_ITEMS`. */
const PLAY_AGAIN_INDEX = GAMEOVER_ITEMS.indexOf("PLAY AGAIN");

let h: Harness;

/** Every field the item names for a round's opening, read off one snapshot. */
function assertFreshRound(round: FacetSnapshot, which: string): void {
  assertEqual(round.screen, "playing", `${which}: the screen a round opens on`);
  assertEqual(round.score, 0, `${which}: score`);
  assertEqual(round.level, 1, `${which}: level`);
  assertEqual(round.levelScore, 0, `${which}: levelScore`);
  // The three figures specs/rules.md returns to 0 when a round starts.
  assertEqual(round.moveScore, 0, `${which}: moveScore`);
  assertEqual(round.bestMove, 0, `${which}: bestMove`);
  assertEqual(round.bestChain, 0, `${which}: bestChain`);
  assertEqual(round.phase, "idle", `${which}: phase`);
  assertEqual(round.chainStep, 0, `${which}: chainStep`);
  assertEqual(round.menuIndex, 0, `${which}: menuIndex`);
  assertEqual(round.selection, null, `${which}: selection`);
  assertEqual(round.offer, null, `${which}: offer`);
  assertEqual(round.refusal, null, `${which}: refusal`);
  // A board is in play, and it is the whole board specs/board.md fixes.
  assertEqual(
    round.board.cols,
    GRID_COLS,
    `${which}: the dealt board's columns`,
  );
  assertEqual(round.board.rows, GRID_ROWS, `${which}: the dealt board's rows`);
  assertLength(
    round.board.cells,
    GRID_COLS * GRID_ROWS,
    `${which}: cells on the dealt board`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh round from the title, and another one from the end of a played round", async () => {
  await h.debug.reset();
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen PLAY is taken from",
  );

  // The first round. PLAY is really CHOSEN, which is what the item says: the
  // highlight is posed onto it — `setMenuIndex` takes no item, so a build whose
  // `up` and `down` never worked is still asked this question — and `confirm`
  // is what takes it, through the key specs/controls.md binds and the build's
  // own input path.
  await takeMenuItem(h, PLAY_INDEX);
  const first = await h.snapshot();
  await captureStill(h, "round");
  assertFreshRound(first, "the first round");

  // Now a round is really played. The posed board carries the one productive
  // exchange the scenario planted, and the swap opens a chain that scores.
  const posed = quietRowsWith(TRIGGER);
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  await loadBoard(h, posed);
  const resolving = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(
    resolving.phase,
    "resolving",
    "the phase the accepted swap opened",
  );

  // And driven to its end: the board the holding step will be read against
  // seeds nothing and offers nothing, so the chain settles and the round is over.
  const dead = deadBoard();
  assertLength(maximalRuns(dead), 0, "maximal runs on the dead board");
  assertLength(legalSwaps(dead), 0, "legal swaps on the dead board");
  await writeBoard(h, dead);
  const over = await advanceStep(h);
  assertEqual(over.screen, "gameover", "the screen the settled round reaches");

  // The figures the played round leaves, posed higher than the round earned
  // them and read back, so every zero asserted below is the fresh round
  // clearing something that was standing.
  await h.debug.setScore(PLAYED_SCORE);
  await h.debug.setLevel(PLAYED_LEVEL);
  await h.debug.setLevelScore(PLAYED_LEVEL_SCORE);
  await h.debug.setBestChain(PLAYED_BEST_CHAIN);
  await h.debug.setBestMove(PLAYED_BEST_MOVE);
  await h.debug.setSelection(PLAYED_SELECTION.col, PLAYED_SELECTION.row);
  await h.debug.setOffer(PLAYED_OFFER.col, PLAYED_OFFER.row);

  const played = await h.snapshot();
  assertEqual(played.score, PLAYED_SCORE, "the score the round banked");
  assertEqual(played.level, PLAYED_LEVEL, "the level the round reached");
  assertEqual(
    played.levelScore,
    PLAYED_LEVEL_SCORE,
    "the level score it banked",
  );
  assertEqual(played.bestChain, PLAYED_BEST_CHAIN, "the level's longest chain");
  assertEqual(played.bestMove, PLAYED_BEST_MOVE, "the level's best move");
  assertDeepEqual(played.selection, PLAYED_SELECTION, "the gem it left held");
  assertDeepEqual(played.offer, PLAYED_OFFER, "the cell it left offered");

  // And the round `PLAY AGAIN` opens is as fresh as the first: every figure of
  // the round that was just played is gone. Taken the same way, from the
  // game-over menu's own entry for it.
  await takeMenuItem(h, PLAY_AGAIN_INDEX);
  assertFreshRound(await h.snapshot(), "the round after a played round");
});
