// screens/paused-lists-items — the pause screen draws its two menu items, in
// order.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`paused`"): "The world held
// still, with the HUD, under `PAUSED_TEXT` (`PAUSED`), and the menu
// `PAUSE_ITEMS` below it: `RESUME`, `MAIN MENU`, in that order."
// specs/controls.md ("The pointer") names `paused` among the screens that
// "show a vertical menu", so the order the items are listed in is the order
// they run down the stage in. specs/ui.md ("Presentation") fixes "no palette,
// no font, and no styling ... each screen's layout is yours except where a
// table below places one element relative to another", so the only arrangement
// asserted is the one the copy states: the first item above the second.
//
// WHY THE WORLD IS POSED AS IT IS. The night is isolated and paused with a REAL
// `KeyP` held across one frame, which is the real route onto the screen, and
// one frame is read for what it draws. Nothing else is posed: the two names are
// fixed copy that no state changes.
//
// THE TOLERANCE. The copy is matched ignoring case and whitespace, across the
// runs of text the frame drew joined in reading order (the shared harness's
// `drewTextAnywhere`) — so a build that letter-spaces an item, wraps the
// highlighted one in marks of its own, or draws a line word by word passes. The stacking is a strict inequality between
// two drawn rows, which no tolerance can soften.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressPause,
  type Harness,
} from "../harness";
import { assertShows, assertStacked, night, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws RESUME above MAIN MENU on the paused frame", async () => {
  await night(h);
  const paused = await pressPause(h);
  assertEqual(paused.screen, "paused", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "menu");

  assertShows(page, PAUSE_ITEMS[0], "the pause menu");
  assertShows(page, PAUSE_ITEMS[1], "the pause menu");
  assertStacked(page, PAUSE_ITEMS[0], PAUSE_ITEMS[1], "the pause menu");
});
