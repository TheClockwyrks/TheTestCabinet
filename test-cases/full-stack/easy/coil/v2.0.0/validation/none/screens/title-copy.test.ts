// screens/title-copy — the title screen draws the copy specs/ui.md fixes for it.
//
// The `title` table names four things the screen carries: `TITLE_TEXT` (`COIL`),
// `TAGLINE_TEXT` (`GRID SERPENT`), `BEST_LABEL` (`BEST`) above the session's best
// score, and the menu, whose second item is `HOW TO PLAY`. Its first item is the
// mode's own entry, which is stated per mode and decided by
// `screens/title-mode-entry-*`.
//
// Matching is by substring and ignores case, because how a build sets its copy is
// its own: a menu entry is commonly drawn with a selection marker beside it, and a
// heading with padding around it. What is required is that the words are on the
// screen.
//
// The title is reached by resetting rather than by pressing anything, so a build
// whose menus do not work still has this point decided on what it draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BEST_LABEL, HOWTO_ITEM, TAGLINE_TEXT, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the title, the tagline, the best label and HOW TO PLAY", async () => {
  const title = await openTitle(h);
  assertEqual(title.screen, "title", "the screen the frame is read from");

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `the title drawing ${TITLE_TEXT}`,
  );
  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title drawing ${TAGLINE_TEXT}`,
  );
  assertEqual(
    drewText(calls, BEST_LABEL),
    true,
    `the title drawing ${BEST_LABEL}`,
  );
  assertEqual(
    drewText(calls, HOWTO_ITEM),
    true,
    `the title drawing ${HOWTO_ITEM}`,
  );
});
