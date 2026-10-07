// controls/a-release-outside-the-pressed-entry-takes-nothing — a press begun on
// an entry and released off it takes no entry.
//
// `specs/ui.md` § The screens: "Both edges fall inside one region or nothing is
// taken: a release outside the region its press went down in takes no entry".
// That is the affordance a player uses to change their mind: press, slide off,
// let go, and nothing happens.
//
// SO NOTHING HERE KNOWS A MENU COORDINATE. The press goes down in the middle of
// the region the build reports for `HOW TO PLAY`, and the release happens at a
// stage point every reported region misses — found by walking a grid over the
// stage, so it holds for any layout a build chooses.
//
// WHAT IS READ IS THE SCREEN. `HOW TO PLAY` opens `howto`, so a build that took
// the entry on a release that landed elsewhere shows `howto` and fails. The
// highlight is not read: `specs/ui.md` has it follow the pointer wherever it
// travels, so where it ends up is that rule's business and not this one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  createHarness,
  offEveryMenuItem,
  slideOffItem,
  type Harness,
} from "../harness";

/** `HOW TO PLAY`: the entry the press goes down in. */
const PRESSED = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes nothing when the release falls outside the entry it was pressed in", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(0);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the menu screen the press lands on");

  const away = await offEveryMenuItem(h, TITLE_ITEMS.length);
  await slideOffItem(h, PRESSED, away);
  const after = await h.snapshot();

  await h.capture("state", "the title menu a slipped press left where it was");

  assertEqual(
    after.screen,
    "title",
    "the screen still showing: the release fell outside the region its press " +
      "went down in, so no entry was taken (specs/ui.md)",
  );
});
