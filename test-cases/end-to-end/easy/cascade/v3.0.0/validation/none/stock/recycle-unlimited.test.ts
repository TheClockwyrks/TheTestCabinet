// stock/recycle-unlimited — passes through the stock are unlimited, and each one
// turns the same cards.
//
// `specs/stock.md`: "Passes through the stock are unlimited, so a stock emptied
// and recycled any number of times behaves the same each time." Klondike is
// often played with a pass limit, and a build that stops recycling after one or
// three passes is a build a player cannot finish a game on; that is what this
// point is here to catch.
//
// FOUR PASSES, each one draining the stock card by card and then recycling the
// waste back into it. Every pass is read the same way: the cards it turned up,
// bottom card first, must be the cards the first pass turned up, in the same
// order, and the recycle at the end of it must refill the stock. A build with a
// three-pass limit reads as a fourth pass that turned nothing; a build that
// resets or reshuffles on a recycle reads as a pass in a different order.
//
// SIX CARDS IS A WHOLE NUMBER OF TURNS UNDER EITHER DEAL MODE, so every pass is
// made of full turns and the short-turn rule is out of the way. They are
// distinct, so a pass is compared as a sequence rather than as a count.
//
// WHY IT IS AN INTEGRATION POINT. It replays the same event twenty-eight times
// and reads one outcome: nothing here implements a player, and the game's own
// turn and recycle are the only things driving it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import {
  captureReplay,
  cards,
  createHarness,
  faceDown,
  openTable,
  poseStock,
  type Harness,
} from "../harness";
import { drainStock, keysOf } from "./turns";

/** The stock, bottom card first, all distinct and six of them. */
const STOCK = ["2C", "3D", "4S", "5H", "6C", "7D"];

/** The cards a pass turns up, bottom card first: the stock's order, reversed. */
const PASS = keysOf(cards(...STOCK).reverse());

/** How many times the stock is emptied and recycled. */
const PASSES = 4;

/**
 * Frames each turn and each recycle is held for while the recording runs.
 *
 * Nothing is read from them and no threshold rests on them: every reading is
 * taken from the state a turn or a recycle left. They are here so the reviewer's
 * player shows each pass rather than a flicker, at the harness's 240 Hz step an
 * eighth of a second apiece.
 */
const HOLD_FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("empties and recycles the stock four times over, turning the same cards each pass", async () => {
  await openTable(h);
  await poseStock(h, faceDown(...STOCK));

  const passes = await captureReplay(h, "passes", async () => {
    const turned: string[][] = [];
    const refilled: number[] = [];
    for (let pass = 0; pass < PASSES; pass += 1) {
      await drainStock(h, STOCK.length, () => h.advance(HOLD_FRAMES));
      turned.push(keysOf((await h.snapshot()).waste));
      // The stock is empty now, so this turn is the recycle.
      await h.debug.turnStock();
      await h.advance(HOLD_FRAMES);
      refilled.push((await h.snapshot()).stock.length);
    }
    return { turned, refilled };
  });

  for (const [pass, turned] of passes.turned.entries()) {
    assertDeepEqual(
      turned,
      PASS,
      `the cards pass ${pass + 1} of ${PASSES} turned up, bottom card first ` +
        "— specs/stock.md: passes through the stock are unlimited, and a " +
        "stock emptied and recycled any number of times behaves the same " +
        "each time",
    );
  }
  assertDeepEqual(
    passes.refilled,
    Array.from({ length: PASSES }, () => STOCK.length),
    `the cards each of the ${PASSES} recycles put back on the stock — a ` +
      "recycle that refilled nothing is a pass limit, which specs/stock.md " +
      "does not allow",
  );
  assertLength(
    (await h.snapshot()).waste,
    0,
    "the cards left on the waste after the last recycle (specs/stock.md)",
  );
});
