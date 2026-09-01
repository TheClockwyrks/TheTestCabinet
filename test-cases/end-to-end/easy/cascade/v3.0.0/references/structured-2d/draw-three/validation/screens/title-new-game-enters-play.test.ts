// screens/title-new-game-enters-play — the title's NEW GAME deals and enters play.
//
// specs/screens.md gives the title's first item its job: "`NEW GAME` — Deals a
// fresh game, as `specs/deal.md` states, and moves to `playing`." specs/controls.md
// fixes how it is reached: a click "activates the control whose hit rectangle
// contains the press point", and `TITLE_NEW_GAME` is `{ x: 480, y: 448, w: 320,
// h: 52 }`. This is the way into the game from a cold start, so a build that
// cannot do it cannot be played at all.
//
// THE GESTURE IS A REAL CLICK AT THE RECTANGLE'S CENTRE — a press and a release
// at the same point, which lies zero units from the press and is therefore inside
// `DRAG_THRESHOLD` (specs/controls.md) — driven through the surface's pointer
// operations, which feed the same input path a player's pointer feeds
// (specs/instrumentation.md). Nothing here poses the screen it is asking for.
//
// BOTH HALVES OF THE ITEM ARE READ, and they are one requirement: this control
// starts a game. The screen alone would pass a build that shows an empty table,
// and the deal alone would pass one that deals behind the title screen.
//
// THE TABLE IS EMPTY BEFORE THE CLICK, because `reset` restores every pile to its
// title-screen value (specs/instrumentation.md), so the fifty-two cards read
// afterwards are the ones this click dealt and not ones that were already there.
// WHAT the deal puts where is the `deal` group's requirement; this point asks only
// that a full deck reached the table.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE, TITLE_NEW_GAME } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickControl,
  createHarness,
  everyCard,
  resetTo,
  type Harness,
} from "../harness";

/** The seed the deal runs off; nothing this point reads turns on it. */
const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("deals a full deck and enters play when NEW GAME is clicked on the title", async () => {
  resetTo(h, SEED);
  const opened = h.snapshot();
  assertEqual(
    opened.screen,
    "title",
    "posing: reset restores the title screen, which is the screen this " +
      "control belongs to (specs/controls.md)",
  );
  assertEqual(
    everyCard(opened).length,
    0,
    "posing: cards on the table before the click, so the deck read after it " +
      "is this control's own deal (specs/instrumentation.md)",
  );

  clickControl(h, TITLE_NEW_GAME);
  await h.advance(1);
  captureStill(h, "playing");

  const started = h.snapshot();
  assertEqual(
    started.screen,
    "playing",
    "the screen a click inside TITLE_NEW_GAME reaches (specs/screens.md)",
  );
  assertEqual(
    everyCard(started).length,
    DECK_SIZE,
    "the cards on the table after that click, which deals a fresh game " +
      "(specs/screens.md, specs/deal.md)",
  );
});
