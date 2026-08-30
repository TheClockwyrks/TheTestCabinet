// Wireworm — screens/pause-quit: confirming QUIT TO MENU leaves the game on the
// title.
//
// specs/ui.md's `paused` menu: `QUIT TO MENU`, the third entry of `PAUSE_ITEMS`,
// "Returns to `title`". The board it is confirmed from is a live one, paused
// with the real pause key, and the highlight is posed on the third entry so the
// confirm is the only thing this decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { CONFIRM_KEY, pauseLiveBoard } from "./screens";

/** Which entry of `PAUSE_ITEMS` is `QUIT TO MENU`. */
const QUIT_ITEM = PAUSE_ITEMS.indexOf("QUIT TO MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the game on the title screen on QUIT TO MENU", async () => {
  await startPlaying(h);
  await pauseLiveBoard(h, QUIT_ITEM);

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen QUIT TO MENU returned to",
  );
});
