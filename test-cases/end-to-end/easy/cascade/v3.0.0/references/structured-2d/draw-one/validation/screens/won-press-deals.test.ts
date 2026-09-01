// screens/won-press-deals — a press on the won screen deals a fresh game.
//
// specs/screens.md, of the `won` screen: "A press deals a fresh game and returns
// to `playing`, as `specs/victory.md` states." specs/victory.md states it in
// full: "A press anywhere, during the cascade or after it, deals a fresh game and
// moves to the `playing` screen." It is the only way out of the ending, so a
// build that answers nothing here strands the player on a finished game.
//
// THE PRESS COMES AFTER THE CASCADE HAS ENDED, which is this point's half of the
// rule: `winning/press-clears-and-deals` drives the press DURING the cascade, and
// a build that answers one and not the other grades apart from one that answers
// neither. The cascade is reached through the game's own win path and run to its
// own end flag, as `screens/won-shows-message` does.
//
// THE PRESS IS ANYWHERE. specs/victory.md puts no rectangle on it, so it is
// driven at the middle of the stage, which lies in no control's rectangle on any
// screen (specs/controls.md) and so cannot be answered as anything but the press
// this rule is about.
//
// BOTH READINGS ARE THE ONE REQUIREMENT: the press starts another game. The
// screen alone would pass a build that leaves the table empty, and the deck alone
// one that deals behind the won screen. Every card is off the table once the
// cascade has run out (specs/victory.md), so the fifty-two read afterwards are
// this press's own deal. WHAT the deal puts where is the `deal` group's
// requirement, and that the press clears the painted table is
// `winning/press-clears-and-deals`.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE, STAGE_H, STAGE_W } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  everyCard,
  framesFor,
  pressAt,
  startCascade,
  type Harness,
} from "../harness";

/**
 * How long the cascade is given to run out, in frames of the suite's clock.
 *
 * The fifty-second launch falls fifty-one launch intervals in — a little over
 * nine seconds at the `LAUNCH_INTERVAL` (`0.18`) specs/victory.md fixes — and the
 * slowest launch the `[180, 420]` range allows then needs under four more to
 * cross the table. Twenty seconds is comfortably past both.
 */
const MAX_FRAMES = framesFor(20);

/** Where the press lands: the middle of the stage, in no control's rectangle. */
const PRESS_X = STAGE_W / 2;
const PRESS_Y = STAGE_H / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals a fresh game and returns to play on a press after the cascade", async () => {
  startCascade(h);

  const run = await h.until((seen) => seen.cascadeDone, {
    maxFrames: MAX_FRAMES,
  });
  assertEqual(
    run.snapshot.cascadeDone,
    true,
    "the cascade's own end flag within twenty seconds of the win, which is " +
      "the state the press below is made in (specs/victory.md)",
  );
  assertEqual(
    everyCard(run.snapshot).length,
    0,
    "cards on the table once the cascade has run out, so the deck read after " +
      "the press is that press's own deal (specs/victory.md)",
  );

  pressAt(h, PRESS_X, PRESS_Y);
  await h.advance(1);
  captureStill(h, "dealt");

  const dealt = h.snapshot();
  assertEqual(
    dealt.screen,
    "playing",
    "the screen a press on the finished won screen reaches " +
      "(specs/victory.md, specs/screens.md)",
  );
  assertEqual(
    everyCard(dealt).length,
    DECK_SIZE,
    "the cards on the table after that press, which deals a fresh game " +
      "(specs/victory.md, specs/deal.md)",
  );
});
