// presentation/tail-turned-toward-its-neighbor — the renderer turns the tail
// toward the segment it joins.
//
// WHAT THE SPECIFICATION FIXES. `specs/assets.md` says what the last cell of the
// chain is drawn with — "The tail sprite, turned toward its one neighbor" — and
// what a turn is: each sprite is "authored in the one orientation the table names
// and rotated in quarter turns when it is drawn". The tail's authored orientation
// has "its one neighbor lying to the right", so a tail whose neighbour lies to
// its right is drawn under no turn at all.
//
// WHY THE TURN IS READ AND NOT THE PIXELS. A tail authored backwards and a
// renderer that turns it backwards compose to a correct picture on every frame,
// so a reading taken off the finished canvas passes both a conformant build and
// that pair. What separates them is the turn the sprite was blitted under, which
// is what the harness reports beside every blit. The other half — that the file
// itself is authored joining right — is
// `presentation/tail-sprite-faces-its-neighbor`.
//
// THE POSE, AND WHY ONE DIRECTION IS ENOUGH. A three-cell chain laid along a row
// with its head to the east, so the tail's one neighbour lies to its right and
// the expected turn is zero. A renderer that turns the tail away from its
// neighbour instead reports a half turn. The error such a renderer makes is a
// single sign, so it shows in every direction alike, and one direction keeps this
// point to one requirement read one way — `presentation/tail-at-the-last-cell`
// already decides that the last cell is painted with a sprite of its own.
//
// The board holds the chain and nothing else: no pellet, no obstacle course, and
// the snake's travel held off, so the frame this reads is the frame it posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  HOME_HEAD,
  arrangeStep,
  blitOnCell,
  captureStill,
  chainFrom,
  createHarness,
  type Harness,
} from "../harness";

/** How long the posed chain is. `specs/board.md` opens a round at three cells. */
const CHAIN = 3;

/**
 * The quarter turn the pose asks for: none.
 *
 * `specs/assets.md` authors the tail with "its one neighbor lying to the right",
 * and the pose puts its one neighbour exactly there, so the sprite is drawn the
 * way it was authored.
 */
const EXPECTED_TURN = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the tail under no turn when its neighbor lies to the right", async () => {
  await arrangeStep(h, { head: HOME_HEAD, dir: "right", length: CHAIN });
  const chain = chainFrom(HOME_HEAD, "right", CHAIN);
  const tail = chain[CHAIN - 1]!;

  const blits = await h.frameBlits();
  await captureStill(h, "turned");

  const painted = blitOnCell(h, blits, tail.col, tail.row);
  if (painted === null) {
    fail(
      `a sprite blitted on the last cell of the chain (${tail.col},${tail.row})`,
      "no bitmap landed on that cell",
    );
  }
  if (painted.quarterTurns === null) {
    fail(
      "the tail sprite drawn under a whole number of quarter turns",
      "a transform that is not a quarter turn",
    );
  }

  assertEqual(
    painted.quarterTurns,
    EXPECTED_TURN,
    "quarter turns the tail sprite was drawn under, with its one neighbor to" +
      " the right (1 is a quarter turn toward down, 2 a half turn, 3 toward up)",
  );
});
