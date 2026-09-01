// winning/press-clears-and-deals — a press during the cascade deals a fresh game.
//
// THE RULE, FROM THREE FILES. specs/victory.md: "A press anywhere, during the
// cascade or after it, deals a fresh game and moves to the `playing` screen. The
// deal clears the painted table, as `specs/deal.md` states."  specs/controls.md
// says the same of the gesture: "on `won` a press deals a fresh game".
// specs/deal.md says what the deal leaves: twenty-eight cards to the seven columns,
// one to the first and seven to the last, the remaining twenty-four as the stock,
// an empty waste and four empty foundations — and "a new deal also clears the
// painted table, so a deal following a victory cascade leaves clean felt behind
// it."
//
// This is the way out of the won screen, and the whole of it. Without it a player
// who has won is stuck watching a painted table, so the point reads all three
// things the press owes at once: the screen, the cleared layer, and a full deal
// underneath.
//
// THE CASCADE IS REAL, NOT POSED. The press is specified as a press DURING the
// cascade, so the game is won through its own move rules and the cascade is left to
// run — launching, flying and painting — until the layer has taken stamps and cards
// are in the air. A posed flyer on a cleared table would test the clearing
// (`deal/deal-clears-trail` does exactly that, and is the point that decides it),
// but not this: what is asked here is whether the way OUT of a running cascade
// works.
//
// THE READING IS TAKEN ON THE PRESS, with no frame advanced. specs/victory.md puts
// the deal on the press itself, and `pointerDown` "takes effect immediately, when it
// is called, rather than being sampled once per frame" (specs/instrumentation.md).
// Reading before the next frame also keeps the reading honest about the layer: the
// specification says a deal clears it and says nothing about what a card still in
// flight would do afterwards, so `trailStamps` is read at the moment the deal
// happened rather than after a frame that might legitimately have stamped it again.
//
// `trailStamps` IS THE WITNESS FOR THE LAYER, not the canvas. specs/instrumentation.md
// defines it as the "stamps on the painted layer since it was cleared", so a deal
// that cleared the layer reports `0`. The pixel reading — that the felt looks like
// felt again — belongs to `deal/deal-clears-trail`, which samples one point of the
// table before and after; duplicating it here would grade one clearing twice.
//
// WHERE THE PRESS LANDS IS NOWHERE IN PARTICULAR, which is the requirement:
// "anywhere". The point chosen is the middle of the stage, which lies in none of the
// six control rectangles specs/controls.md fixes — and in any case "a control
// answers only on the screen it belongs to", and none of the six belongs to `won`.

import { afterEach, beforeEach, it } from "vitest";
import {
  DEAL_STOCK_CARDS,
  DECK_SIZE,
  FOUNDATION_COUNT,
  STAGE_H,
  STAGE_W,
  TABLEAU_COLUMNS,
} from "../../src/constants";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startCascade,
  tableCards,
  type Harness,
} from "../harness";

/**
 * How long the cascade is left to run before the press, in frames.
 *
 * Half a second, which is more than two `LAUNCH_INTERVAL`s (`0.18` s,
 * specs/victory.md), so several cards are in the air and every one of them has
 * stamped the painted layer on every frame it flew. That is the state the
 * requirement names — a press DURING the cascade — and it is what the assertions
 * below check the press was made against before they check what it did.
 */
const CASCADE_FRAMES = framesFor(0.5);

/** The middle of the stage, which is a press on nothing in particular. */
const PRESS_X = STAGE_W / 2;
const PRESS_Y = STAGE_H / 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("deals a fresh game onto clean felt when a press lands during the cascade", async () => {
  startCascade(harness);
  await harness.advance(CASCADE_FRAMES);

  const running = harness.snapshot();
  assertEqual(
    running.screen,
    "won",
    "the screen the cascade runs on, which is where the press is made " +
      "(specs/screens.md)",
  );
  assertGreaterThan(
    running.launched,
    0,
    `cards the cascade had launched ${String(CASCADE_FRAMES)} frames in, so ` +
      "the press below lands DURING the cascade (specs/victory.md)",
  );
  assertGreaterThan(
    running.trailStamps,
    0,
    "stamps on the painted layer when the press was made, which is what the " +
      "deal is then asked to clear (specs/victory.md)",
  );

  harness.debug.pointerDown(PRESS_X, PRESS_Y);
  const dealt = harness.snapshot();

  await harness.advance(1);
  captureStill(harness, "dealt");

  assertEqual(
    dealt.screen,
    "playing",
    `the screen a press at (${String(PRESS_X)}, ${String(PRESS_Y)}) during ` +
      "the cascade left (specs/victory.md)",
  );
  assertEqual(
    dealt.trailStamps,
    0,
    "stamps on the painted layer the press's deal left, a new deal clearing " +
      "the painted table (specs/deal.md)",
  );

  assertLength(
    tableCards(dealt),
    DECK_SIZE,
    "cards on the thirteen piles after the press dealt a fresh game " +
      "(specs/deal.md)",
  );
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    assertLength(
      dealt.tableau[column] ?? [],
      column + 1,
      `cards in column ${String(column)} of the fresh deal (specs/deal.md)`,
    );
  }
  assertLength(
    dealt.stock,
    DEAL_STOCK_CARDS,
    "cards in the stock of the fresh deal (specs/deal.md)",
  );
  assertLength(
    dealt.waste,
    0,
    "cards on the waste of the fresh deal (specs/deal.md)",
  );
  for (let slot = 0; slot < FOUNDATION_COUNT; slot += 1) {
    assertLength(
      dealt.foundations[slot] ?? [],
      0,
      `cards on foundation ${String(slot)} of the fresh deal (specs/deal.md)`,
    );
  }
});
