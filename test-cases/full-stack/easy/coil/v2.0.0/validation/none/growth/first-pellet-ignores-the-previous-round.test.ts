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
// WHY THIS IS DECIDED DETERMINISTICALLY RATHER THAN BY SAMPLING. One cell out of
// roughly four hundred and forty is a difference no honest number of rounds
// separates from chance, and a check that fails one run in a hundred is worse
// than no check. So the two rounds are made IDENTICAL except for the one thing
// under test:
//
//   1. A round is opened under a seed the ordinary way, and its first pellet `P`
//      is read.
//   2. The session is reset under the SAME seed, `P` is placed on the board, and
//      a round is opened the same way.
//
// specs/instrumentation.md makes step 2's placement free of side effects on the
// draw: "Placing a pellet is not spawning one, so the generator is not drawn from
// and the seeded sequence is left where it stands". The generator
// therefore stands in the identical state at both round openings, and a build
// that lays the round out from an empty board draws `P` again. A build that
// carries the old pellet across excludes `P` and draws something else.
//
// WHY THE ROUND IS OPENED FROM THE MENU. A round BEGINNING is the thing under
// test, and specs/instrumentation.md says `setScreen("playing")` is not one: it
// "runs the tick over the board as it stands rather than laying out a fresh
// round". The title menu's first item is the mode's own entry (specs/mode.md),
// so that is the route in both rounds.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { START_CELLS, type Cell } from "../constants";
import {
  captureStill,
  chooseItem,
  createHarness,
  holdsCell,
  type Harness,
} from "../harness";

/** The one seed both rounds are laid under, so the two draws are the same draw. */
const SEED = 4242;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Open a round from the title the way a player does, and read its first pellet. */
async function openRound(): Promise<Cell> {
  await chooseItem(h, 0);
  const opened = await h.snapshot();
  assertEqual(opened.screen, "playing", "the screen the mode entry opened");
  assertNotNull(opened.pellet, "the first pellet of the opened round");
  return opened.pellet as Cell;
}

it("draws the same first cell whether or not a pellet sat there", async () => {
  await h.debug.reset({ seed: SEED });
  const drawn = await openRound();
  // The placement below has to be a legal one, and specs/board.md keeps the
  // first pellet off the starting chain — the point that decides that is
  // `first-pellet-off-start-chain`, and a build failing it fails there.
  assertEqual(
    holdsCell(START_CELLS, drawn),
    false,
    "the first pellet clear of the starting chain, so it can be placed again",
  );

  await h.debug.reset({ seed: SEED });
  await h.debug.setPellet(drawn.col, drawn.row);
  const again = await openRound();
  await captureStill(h, "reopened");

  assertDeepEqual(
    again,
    drawn,
    `the first pellet of a round opened with a pellet already on ${drawn.col},${drawn.row}`,
  );
});
