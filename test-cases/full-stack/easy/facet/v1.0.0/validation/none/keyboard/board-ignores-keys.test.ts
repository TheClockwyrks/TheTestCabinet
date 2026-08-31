// Facet — keyboard/board-ignores-keys: nothing on `playing` answers a key but
// `pause` and `mute`.
//
// specs/controls.md ends its actions table with the sentence this point is
// entirely about: "The keyboard drives the menus; the board is played with the
// pointer alone." The three menu actions say so themselves — `up` "Moves the menu
// highlight up", `down` "Moves the menu highlight down", `confirm` "Chooses the
// highlighted menu item" — and `playing` carries no menu, which specs/ui.md
// states from the other side by resting `menuIndex` at `0` there. So the board,
// the gem the player has hold of, and the neighbor it is offered into are all
// beyond the keyboard's reach, and a move is played by a release and by nothing
// else.
//
// THE FIXTURE IS THE WHOLE ARGUMENT. A check that pressed these keys on a bare
// board would read four nothings whatever the build did with them. So the board
// is posed mid-gesture — a gem held at the selection, its neighbor standing as
// the offer, and the exchange of the two PRODUCTIVE — which is exactly the state
// a keyboard selection model would act on. A build that kept one has `up` and
// `down` walk the selection off its cell, or `confirm` take the offer and open a
// chain; either shows here as a reading that moved, and on this board a taken
// offer is an accepted swap rather than a refusal, so it cannot be mistaken for
// the board standing still.
//
// BOTH KEYS OF `confirm` ARE PRESSED. specs/controls.md gives the action `Enter`
// and `Space` and says "Each key listed for an action fires that action on its
// own", so a build that wired one of them onto the board is not let through by a
// check that pressed the other.
//
// WHAT IS READ AFTER EACH PRESS. All 64 cells, the selection, the offer, the
// phase and the score — five readings, because the five wrong answers a keyboard
// board model gives are five different faults. A frame is advanced with each
// press, so what is read is a state the build has actually run an update over
// rather than one caught between two.
//
// WHAT THIS DOES NOT DECIDE. That `pause` and `mute` DO act on this screen is
// `keyboard/pause-key`, `keyboard/pause-escape` and `keyboard/mute-key`; that the
// three keys pressed here drive a MENU where there is one is the `screens`
// category's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  assertBoardEquals,
  quietRowsWithEscape,
  swapIsProductive,
  type BoardRows,
  type CellRef,
  type PlacedToken,
} from "../board";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

/**
 * Three rubies one exchange short of a run in row 4, clear of the filler's spare
 * corner swap.
 *
 * They are what make the posed offer a PRODUCTIVE one: exchanging the held gem
 * with the cell it is offered into completes the row, so a build that took the
 * offer on a key would leave an accepted swap behind rather than a refusal that
 * could be mistaken for the board standing still.
 */
const RUN_CELLS: readonly PlacedToken[] = [
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
];

/** The gem the player has hold of. */
const SELECTED: CellRef = { col: 3, row: 3 };

/** The neighbor it is offered into, which a release would play. */
const OFFERED: CellRef = { col: 3, row: 4 };

/**
 * The keys the menu actions are bound to, every one of them.
 *
 * Read out of specs/controls.md's table rather than written down, and both of
 * `confirm`'s, since either fires the action alone.
 */
const MENU_KEYS: readonly string[] = [
  ...BINDINGS.up,
  ...BINDINGS.down,
  ...BINDINGS.confirm,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the board, the selection and the offer where they stand", async () => {
  const posed = quietRowsWithEscape(RUN_CELLS);
  assertTrue(
    swapIsProductive(posed, SELECTED, OFFERED),
    "the posed offer is an exchange R3 would accept, so a key that took it " +
      "would open a chain rather than raise a refusal",
  );

  await loadBoard(h, posed);
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  await h.debug.setOffer(OFFERED.col, OFFERED.row);

  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the keys are pressed on");
  assertDeepEqual(before.selection, SELECTED, "the gem the player has hold of");
  assertDeepEqual(before.offer, OFFERED, "the neighbor it is offered into");
  assertEqual(before.phase, "idle", "the phase the board rests in");

  /** Everything the press must have left exactly as it found it. */
  const standing = async (key: string, board: BoardRows): Promise<void> => {
    const after = await h.snapshot();
    assertBoardEquals(board, posed, `the board after ${key}`);
    assertDeepEqual(after.selection, SELECTED, `the selection after ${key}`);
    assertDeepEqual(after.offer, OFFERED, `the offer after ${key}`);
    assertEqual(after.phase, "idle", `the phase after ${key}`);
    assertEqual(after.score, before.score, `the score after ${key}`);
  };

  for (const key of MENU_KEYS) {
    // A real press of the bound key, and the frame that reads it: `tap` sends
    // the edge down and up and then runs one update, which is the frame a build
    // that answered the key would have acted on.
    await h.tap(key);
    await standing(key, await h.board());
  }

  // The last frame that ran is the board with the gem still held and the offer
  // still standing, which is the picture the keys were meant not to disturb.
  await captureStill(h, "board");
});
