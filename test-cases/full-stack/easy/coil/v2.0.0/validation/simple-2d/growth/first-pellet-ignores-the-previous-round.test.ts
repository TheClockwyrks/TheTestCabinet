// growth/first-pellet-ignores-the-previous-round — the cell the round before left
// its pellet on is in the first draw of the next round.
//
// specs/board.md fixes the valid set a pellet is drawn from, and the fourth
// condition is that a cell "is not the cell the current pellet occupies". It then
// says what the board holds when a round is laid: "The first pellet of a round is
// placed after the snake is laid at its starting cells... The board carries no
// pellet at that moment, so every interior cell clear of the starting chain and
// of the obstacles is in the set that first draw is made from, wherever the round
// before it left its pellet."
//
// WHAT GOES WRONG WITHOUT IT. A build that lays the chain but forgets to take the
// old pellet off the board draws its first pellet from a set one cell short: the
// one cell the previous round happened to end on can never open the next one. It
// is invisible in play, and it makes a round's opening depend on the round before
// it — which nothing about the specification does.
//
// THE DRAW IS POSED RATHER THAN SAMPLED. One cell out of roughly four hundred and
// forty is a difference no honest number of rounds separates from chance. So a
// pellet is placed on a cell, that same cell is posed as the next spawn with
// `setNextPellet`, and a round is opened. specs/instrumentation.md honors the
// pose "when the cell is in the valid set specs/board.md defines at that moment"
// and discards it otherwise: a build that lays the round out from an empty board
// has the cell in its set and places the first pellet there, and a build that
// carries the old pellet across holds the cell out of its set and draws somewhere
// else.
//
// WHY THE ROUND IS OPENED FROM THE MENU. A round BEGINNING is the thing under
// test, and specs/instrumentation.md says `setScreen("playing")` is not one: it
// "runs the tick over the board as it stands rather than laying out a fresh
// round". The title menu's first item is the mode's own entry (specs/mode.md),
// so that is the route.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { START_CELLS, type Cell } from "../constants";
import {
  captureStill,
  chooseItem,
  createHarness,
  type Harness,
} from "../harness";

/**
 * The cell the previous round is left holding its pellet on: on the starting
 * row, which specs/mode.md keeps clear of every course, and clear of the
 * starting chain, so it is in the valid set of a round laid from an empty board
 * under either mode.
 */
const LEFTOVER: Cell = { col: 25, row: START_CELLS[0].row };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays the first pellet on the cell the last round left one on", async () => {
  h.debug.reset();
  h.debug.setPellet(LEFTOVER.col, LEFTOVER.row);
  h.debug.setNextPellet(LEFTOVER.col, LEFTOVER.row);
  await chooseItem(h, 0);
  const opened = h.snapshot();
  captureStill(h, "reopened");

  assertEqual(opened.screen, "playing", "the screen the mode entry opened");
  assertDeepEqual(
    opened.pellet,
    LEFTOVER,
    `the first pellet of a round opened with a pellet already on ${LEFTOVER.col},${LEFTOVER.row}`,
  );
});
