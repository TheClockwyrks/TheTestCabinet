// screens/title-howto-opens-howto — `HOW TO PLAY` opens the how-to screen.
//
// `specs/ui.md` § The screens, Title: "the menu `TITLE_ITEMS` (`SITES`, `HOW TO
// PLAY`), with `menuIndex` `0` on arriving. `SITES` opens `select`, `HOW TO PLAY`
// opens `howto`."
//
// `HOW TO PLAY` is `TITLE_ITEMS` index `1`, so the highlight is posed there with
// `setMenuIndex` — "sets the highlighted entry of the menu on the screen showing"
// (`specs/instrumentation.md`) — rather than walked there with `down`, which is
// the direction actions' own review point. What is then pressed is `confirm`, the
// action `specs/ui.md` says "takes the highlighted entry": this item is about
// where the entry leads, and the press is the only way to take it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** `HOW TO PLAY`, the title menu's second entry. */
const ENTRY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens howto from the title menu's HOW TO PLAY entry", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(ENTRY);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen the entry is taken on");
  assertEqual(posed.menuIndex, ENTRY, "the highlighted title entry");

  await h.press(CONFIRM);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    `the screen TITLE_ITEMS[${ENTRY}], HOW TO PLAY, opens (specs/ui.md)`,
  );

  await h.advance(1);
  await h.capture("state", "The screen HOW TO PLAY opened");
});
