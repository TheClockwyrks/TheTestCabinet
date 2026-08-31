// Facet — keyboard/cursor-up: the `up` action steps the cursor one row toward
// row 0, and leaves its column exactly where it was.
//
// The cursor is the keyboard's entire hold on the board. `specs/controls.md`
// gives it one cell of the `playing` screen, four actions that move it, and a
// `confirm` that acts on whatever cell it is standing on — so a build that
// reads `up` as two rows, as a column, or as a step down the board does not
// merely mis-draw a marker: every keyboard swap it goes on to make is aimed at
// a cell the player never chose. Row 0 is the first row of `specs/board.md`'s
// reading order, so `up` is the step that LOWERS the row.
//
// BOTH KEYS, EACH ON ITS OWN. `specs/controls.md` binds `up` to `ArrowUp` and
// `KeyW` and states that each key listed for an action fires that action on its
// own, so the step is driven once per key rather than once for the action.
//
// THE WHOLE KEY PATH IS THE BUILD'S. An engineless run is handed no runtime, so
// the listener, the binding table and the press edge are the build's own code —
// `specs/instrumentation.md` puts the keyboard in that layer and gives the
// surface no keyboard operation at all. The keys below are pressed through
// Chromium's own input pipeline, so what arrives is a browser-trusted key event
// on the real page, and every step from a physical key to the reading taken
// afterwards is the build's.
//
// The step is driven from an interior cell, so what an edge does to a movement
// that would leave the board is `keyboard/cursor-stays-on-board`'s point and is
// not read here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureReplay,
  createHarness,
  poseBoardWithEscape,
  type Harness,
} from "../harness";

/**
 * The cell every step is driven from.
 *
 * Interior on all four sides, so a step in any direction is one the board
 * allows and the edge rule of `specs/controls.md` never comes into it, and
 * clear of the three cells the quiet filler spends on its escape swap.
 */
const START = { col: 4, row: 4 };

/**
 * Frames run at rest either side of a press.
 *
 * Nothing is measured across them — the cursor is read from the game's own
 * state — but they are what makes the captured replay read as a cursor sitting
 * still, stepping once, and sitting still again, rather than as a marker that
 * was already somewhere else.
 */
const REST_FRAMES = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("steps the cursor one row toward row 0, whichever key fires `up`", async () => {
  // The cursor is driven on `playing`, and a posed board rests exactly as it
  // was written until a swap is accepted on it, so the cursor is the only thing
  // on this board that moves.
  const posed = await poseBoardWithEscape(h, []);
  assertEqual(posed.screen, "playing", "the screen the cursor is driven on");

  await captureReplay(h, "cursor", async () => {
    for (const code of BINDINGS.up) {
      // Each key is driven from the same posed cell rather than from wherever
      // the key before it left the cursor, so what is read back after a press
      // is one press's worth of movement and never two keys' worth.
      await h.debug.setCursor(START.col, START.row);
      await h.advance(REST_FRAMES);
      assertDeepEqual((await h.snapshot()).cursor, START, `the posed cursor, before ${code}`);

      await h.tap(code);
      await h.advance(REST_FRAMES);

      // One row toward row 0, and the column untouched: the row is one lower
      // than the posed one and the column is the one the step began on.
      assertDeepEqual(
        (await h.snapshot()).cursor,
        { col: START.col, row: START.row - 1 },
        `the cursor after one ${code}`,
      );
    }
  });
});
