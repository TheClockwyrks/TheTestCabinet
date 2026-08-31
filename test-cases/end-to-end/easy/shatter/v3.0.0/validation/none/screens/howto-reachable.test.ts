// Shatter — screens/howto-reachable: confirming the title menu's second entry opens
// the how-to screen.
//
// THE RULE. `specs/ui.md` puts `HOW TO PLAY` second in `TITLE_ITEMS` and says it
// "moves to `howto`", the screen it names "how to play".
//
// THE ENTRY IS ADDRESSED, NOT COUNTED. `setMenuIndex(1)` places the highlight
// directly; counting presses onto it would grade `controls/menu-down-arrow` a second
// time and would fail this item for that key's faults. The confirm key is a real one
// through Chromium's own input pipeline, because `specs/instrumentation.md` carries
// no operation that takes a menu entry — and the screen is never posed, since
// `setScreen("howto")` would answer the question for the build.
//
// WHAT THIS ITEM DOES NOT DECIDE. What the how-to screen SAYS
// (`screens/howto-shows-the-controls`), how it is left
// (`screens/howto-returns`), or what the first entry does
// (`screens/play-starts-a-game`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { confirmEntry, reachTitle } from "./screens";

/** The title menu's second entry, `HOW TO PLAY` (`specs/ui.md`). */
const HOWTO_ENTRY = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen when HOW TO PLAY is confirmed", async () => {
  assertEqual(
    TITLE_ITEMS[HOWTO_ENTRY],
    "HOW TO PLAY",
    "the title menu's second entry, which specs/ui.md fixes",
  );

  await reachTitle(h);
  await confirmEntry(h, HOWTO_ENTRY);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the confirmed HOW TO PLAY entry opened",
  );
});
