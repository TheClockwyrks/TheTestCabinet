// Wick — screens/title-copy: the title screen draws its five pieces of copy,
// with the three menu items stacked one above the next.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`title`", names
// each string by its constant: `TITLE_TEXT` (`WICK`), `TAGLINE_TEXT`
// (`KEEP THE LIGHT`), and `TITLE_ITEMS` (`LIGHT THE LAMP`, `THE ALMANAC`,
// `HOW TO PLAY`, "in that order"); and "The menu's items are stacked one above
// the next under the title and tagline."
//
// WHAT IS READ, AND WHY. The strings the frame drew, and where it drew them.
// The palette, the font, and the placement are the build's ("Wick fixes no
// palette, no font, and no styling for any screen"), so the reading is which
// copy appeared and, for the three menu items alone, which of them sits higher
// on the stage. A run of text is matched as a SUBSTRING, so a build that marks
// its highlighted item (`> LIGHT THE LAMP <`) or pads its lines still reads as
// having drawn the copy.
//
// THE DRIVE. `reset` to the title screen and one frame. Nothing is pressed:
// the copy is what the screen draws before anything is touched.
//
// THE TOLERANCE. The strings are exact, ignoring case and surrounding
// characters. The stacking is strict: each item's topmost anchor is ABOVE the
// next item's, with no slack, since two items drawn at one height are not
// stacked at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertNotNull, assertTrue } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  textDraws,
  type Harness,
} from "../harness";
import { anchorY } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the title, the tagline, and the three menu items in order", async () => {
  h.reset();

  const { calls } = await h.frameDraw();
  captureStill(h, "title");

  for (const copy of [TITLE_TEXT, TAGLINE_TEXT, ...TITLE_ITEMS]) {
    assertTrue(
      drewText(calls, copy),
      `the title frame drew ${JSON.stringify(copy)} (specs/ui.md, title)`,
    );
  }

  const draws = textDraws(calls);
  for (let index = 0; index + 1 < TITLE_ITEMS.length; index += 1) {
    const above = anchorY(draws, TITLE_ITEMS[index]);
    const below = anchorY(draws, TITLE_ITEMS[index + 1]);
    assertNotNull(above, `where ${TITLE_ITEMS[index]} was drawn`);
    assertNotNull(below, `where ${TITLE_ITEMS[index + 1]} was drawn`);
    assertLessThan(
      above as number,
      below as number,
      `${TITLE_ITEMS[index]} stacked above ${TITLE_ITEMS[index + 1]}, in device pixels down the stage`,
    );
  }
});
