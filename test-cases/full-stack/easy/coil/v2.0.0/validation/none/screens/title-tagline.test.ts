// screens/title-tagline — the title screen draws its tagline.
//
// specs/ui.md's `title` table gives the screen a Tagline, `TAGLINE_TEXT` (`GRID
// SERPENT`), on its own row beside the title, the best-score readout and the
// menu — so it is its own point.
//
// Matching is by substring and ignores case, because how a build sets its copy is
// its own: a heading is commonly drawn with padding around it and a menu entry
// with a selection marker beside it. What is required is that the words are on
// the screen.
//
// The title is reached by resetting rather than by pressing anything, so a build
// whose menus do not work still has this point decided on what it draws.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TAGLINE_TEXT } from "../constants";
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

it("draws its tagline", async () => {
  const title = await openTitle(h);
  assertEqual(title.screen, "title", "the screen the frame is read from");

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, TAGLINE_TEXT),
    true,
    `the title drawing ${TAGLINE_TEXT}`,
  );
});
