// screens/title-heading — the title screen draws its title.
//
// specs/ui.md's `title` table gives the screen a Title, `TITLE_TEXT` (`COIL`).
// It is one of four elements that table names, and each is its own point: a build
// that draws the heading and omits the best-score readout has to grade
// differently from one that draws nothing on the screen at all.
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
import { drewText } from "../case-harness/text";
import { TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
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

it("draws its title", async () => {
  const title = await openTitle(h);
  assertEqual(title.screen, "title", "the screen the frame is read from");

  const calls = await h.frameCalls();
  await captureStill(h, "title");

  assertEqual(
    drewText(calls, TITLE_TEXT),
    true,
    `the title drawing ${TITLE_TEXT}`,
  );
});
