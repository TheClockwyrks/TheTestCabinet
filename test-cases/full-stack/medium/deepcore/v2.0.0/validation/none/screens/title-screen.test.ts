// screens/title-screen — the game rests on the title, and the title names itself.
//
// specs/ui.md: the `title` screen shows "The title `TITLE_TEXT` (`DEEPCORE`), a
// tagline, and the main menu". specs/instrumentation.md fixes the same screen as
// the resting state a `reset` restores, "the `title` screen with `menuIndex` at
// `0`".
//
// TWO READINGS OF ONE FRAME, and they are one behavior: the game is ON the title
// screen, and that screen drew `TITLE_TEXT`. A build that opens somewhere else
// has not got a title screen at all, and one that opens on a blank screen has not
// got a title.
//
// FOUR POINTS, NOT ONE. specs/ui.md names four things about this screen — that
// the game is on it and it carries the title, that it carries a tagline, that it
// carries the main menu, and that the highlighted entry is drawn distinctly — and
// a build that gets three of them right must grade differently from one that gets
// none. The other three are `screens/title-screen-tagline`,
// `screens/title-menu-drawn` and `screens/title-menu-highlight-is-distinct`.
//
// ISOLATION. A fresh harness reset to its resting state with the save slot
// cleared, so the menu is the one specs/ui.md lists with no save banked and
// nothing on the screen belongs to an expedition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rests on the title screen, naming the game", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "specs/ui.md: the game rests on the title screen",
  );
  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `specs/ui.md: the title screen shows TITLE_TEXT (${TITLE_TEXT})`,
  );
});
