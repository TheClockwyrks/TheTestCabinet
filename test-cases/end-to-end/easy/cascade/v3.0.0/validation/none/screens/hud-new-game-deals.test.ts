// screens/hud-new-game-deals — the HUD's `NEW GAME` deals a fresh game and stays
// on `playing`.
//
// `specs/screens.md`, the HUD's table: "`NEW GAME` | `HUD_ITEMS[0]` |
// `HUD_NEW_GAME` | Deals a fresh game and stays on `playing`."
// `specs/controls.md` fixes the rectangle at `{ x: 224, y: 680, w: 180, h: 36 }`
// and fixes that a control answers a click — a press with its release within
// `DRAG_THRESHOLD` of it.
//
// BOTH HALVES ARE ASSERTED, because the sentence has two, and they fail
// differently: a build that dealt and dropped back to the title has the same
// cards on the table as a correct one, and a build that stayed on `playing`
// without dealing has the same screen. The table is cleared before the click, so
// the fifty-two cards afterwards are this control's doing.
//
// It is the HUD's own item. The title screen's `NEW GAME`, which reaches
// `playing` from OUTSIDE it, is `screens/title-new-game-enters-play`: two
// controls, two rectangles, two items, so a build that wired one and not the
// other grades for exactly the one it missed. The shape of the deal belongs to
// the `deal` group.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { DECK_SIZE, HUD_NEW_GAME } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  everyCard,
  openTable,
  rectCenter,
  type Harness,
} from "../harness";

/** The point pressed and released: the centre of the control's own rectangle. */
const PRESS = rectCenter(HUD_NEW_GAME);

/** One frame, so the canvas carries the table the assertions read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("deals a full deck without leaving the table", async () => {
  await openTable(h);
  assertLength(
    everyCard(await h.snapshot()),
    0,
    "the cards on the table before the click",
  );

  await clickAt(h, PRESS.x, PRESS.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "dealt");

  const after = await h.snapshot();
  assertLength(
    everyCard(after),
    DECK_SIZE,
    "the cards the click put on the table (specs/deal.md)",
  );
  assertEqual(
    after.screen,
    "playing",
    "the screen the HUD's NEW GAME left the game on (specs/screens.md)",
  );
});
