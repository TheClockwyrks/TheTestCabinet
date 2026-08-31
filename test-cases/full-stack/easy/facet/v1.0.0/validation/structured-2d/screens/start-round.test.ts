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
// own point, not this one.
//
// TWO ROUNDS, AND THE SECOND IS THE ONE THAT DECIDES IT. The first `start()`
// opens from a game that has played nothing, which a build carrying state over
// would still pass. So the round is then dirtied through the poses
// specs/instrumentation.md gives for exactly that — a score, a level, a level
// score, a moved cursor and a selection — carried back to the title the way a
// player leaves a round, and started again. Every field is asserted the same
// way both times, by the same helper, because "fresh" has to mean the same
// thing on the second round as on the first.
//
// The board is asserted as a board IN PLAY — the full GRID_COLS x GRID_ROWS
// specs/board.md fixes, rather than the `{ cols: 0, rows: 0, cells: [] }` that
// specs/instrumentation.md says stands while no board is in play. What that
// dealt board must contain — no run, a legal swap, plain and clean gems — is
// specs/rules.md's opening deal, and each of those is a point of its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  CURSOR_START_COL,
  CURSOR_START_ROW,
  GRID_COLS,
  GRID_ROWS,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import type { FacetSnapshot } from "../surface";

/** Frames the first round is left running for, so it is a round that was played. */
const PLAYED_FRAMES = 8;

/** The residue of a round: figures no fresh round may be handed. */
const PLAYED_SCORE = 4321;
const PLAYED_LEVEL = 3;
const PLAYED_LEVEL_SCORE = 777;
const PLAYED_CURSOR = { col: 5, row: 6 };
const PLAYED_SELECTION = { col: 2, row: 3 };

let h: Harness;

/** Every field specs/ui.md and specs/instrumentation.md fix for a round's opening. */
function assertFreshRound(round: FacetSnapshot, which: string): void {
  assertEqual(round.screen, "playing", `${which}: the screen a round opens on`);
  assertEqual(round.score, 0, `${which}: score`);
  assertEqual(round.level, 1, `${which}: level`);
  assertEqual(round.levelScore, 0, `${which}: levelScore`);
  assertEqual(round.phase, "idle", `${which}: phase`);
  assertEqual(round.chainStep, 0, `${which}: chainStep`);
  assertEqual(round.menuIndex, 0, `${which}: menuIndex`);
  assertDeepEqual(
    round.cursor,
    { col: CURSOR_START_COL, row: CURSOR_START_ROW },
    `${which}: the cell the cursor opens on`,
  );
  assertEqual(round.selection, null, `${which}: selection`);
  assertEqual(round.refusal, null, `${which}: refusal`);
  // A board is in play, and it is the whole board specs/board.md fixes.
  assertEqual(round.board.cols, GRID_COLS, `${which}: the dealt board's columns`);
  assertEqual(round.board.rows, GRID_ROWS, `${which}: the dealt board's rows`);
  assertEqual(
    round.board.cells.length,
    GRID_COLS * GRID_ROWS,
    `${which}: cells on the dealt board`,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a fresh round from the title, and another one after a round was played", async () => {
  h.debug.reset();
  assertEqual(h.snapshot().screen, "title", "the screen `start` is taken from");

  // The first round: nothing has been played, so this is the opening state
  // specs/instrumentation.md lists, read straight off the pose.
  h.debug.start();
  const first = h.snapshot();
  captureStill(h, "round");
  assertFreshRound(first, "the first round");

  // Now play one: let frames run, bank a score and a level, and leave the
  // cursor and a selection somewhere other than where a round opens. Each is
  // read back, so what the second round has to clear away is known to be there
  // rather than assumed.
  await h.advance(PLAYED_FRAMES);
  h.debug.setScore(PLAYED_SCORE);
  h.debug.setLevel(PLAYED_LEVEL);
  h.debug.setLevelScore(PLAYED_LEVEL_SCORE);
  h.debug.setCursor(PLAYED_CURSOR.col, PLAYED_CURSOR.row);
  h.debug.setSelection(PLAYED_SELECTION.col, PLAYED_SELECTION.row);
  const played = h.snapshot();
  assertEqual(played.score, PLAYED_SCORE, "the score the round banked");
  assertEqual(played.level, PLAYED_LEVEL, "the level the round reached");
  assertEqual(played.levelScore, PLAYED_LEVEL_SCORE, "the level score it banked");
  assertDeepEqual(played.cursor, PLAYED_CURSOR, "where the round left the cursor");
  assertDeepEqual(played.selection, PLAYED_SELECTION, "what the round left selected");

  // Leave the round the way a player leaves one, back to the title.
  h.debug.pause();
  h.debug.quit();
  assertEqual(h.snapshot().screen, "title", "the screen a quit round returns to");

  // With the highlight moved off the first item, so `menuIndex` being 0 in the
  // round below is the round setting it rather than it never having moved.
  await h.tapAction("down");

  // And the second round is as fresh as the first: every figure of the round
  // that was just played is gone.
  h.debug.start();
  assertFreshRound(h.snapshot(), "the round after a played round");
});
