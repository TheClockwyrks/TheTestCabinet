// screens/title-new-game-enters-play — the title's `NEW GAME` deals a fresh game
// and moves to `playing`.
//
// `specs/screens.md`, the `title` screen's item table: "`NEW GAME` — Deals a
// fresh game, as `specs/deal.md` states, and moves to `playing`."
// `specs/controls.md` fixes how the item is reached: "Either kind of gesture
// activates a control when one control's hit region holds both the press point
// and the release point." WHERE that region is is the build's own, so the press
// is made at the middle of what `menuItemRect(TITLE_NEW_GAME_ITEM)` answered
// with.
//
// THE POSE IS WHAT MAKES THE DEAL READABLE. The table is cleared before the
// click, so the fifty-two cards afterwards are cards this control put there and
// not cards that were already lying about. A build whose control changed the
// screen without dealing reads as a table of nothing; a build that dealt without
// changing the screen reads as `title`; and the two are told apart because both
// halves are asserted here.
//
// WHAT IT DOES NOT DECIDE. The SHAPE of the deal — seven columns of the right
// sizes, twenty-four in the stock, the lowest card of each column face-up — is
// the `deal` group's, item by item. This one asks only that a full deck reached
// the table, which is the whole of what `specs/deal.md` guarantees is there to
// count from outside its own group.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE, TITLE_NEW_GAME_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  everyCard,
  menuPoint,
  openTitle,
  type Harness,
} from "../harness";

/** One frame, so the canvas carries the table the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals a full deck and enters play", async () => {
  await openTitle(h);
  assertLength(
    everyCard(await h.snapshot()),
    0,
    "the cards on the table before the click",
  );

  const press = await menuPoint(h, TITLE_NEW_GAME_ITEM);
  await clickAt(h, press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "playing");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "playing",
    "the screen the title's NEW GAME reached (specs/screens.md)",
  );
  assertLength(
    everyCard(after),
    DECK_SIZE,
    "the cards the click put on the table (specs/deal.md)",
  );
});
