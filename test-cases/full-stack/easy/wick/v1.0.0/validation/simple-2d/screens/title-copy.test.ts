// screens/title-copy — the title screen draws its copy.
//
// WHAT THIS DECIDES. One thing: the four pieces of copy specs/ui.md gives the
// title screen are on the frame, and the two menu items are stacked one above
// the next in the order `TITLE_ITEMS` gives them.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): the table "Title | `TITLE_TEXT` | `WICK`", "Tagline
//   | `TAGLINE_TEXT` | `KEEP THE LIGHT`", "Menu | `TITLE_ITEMS` | `LIGHT THE
//   LAMP`, `HOW TO PLAY`, in that order", and "The menu's items are stacked one
//   above the next under the title and tagline."
//   specs/ui.md ("Presentation"): "Wick fixes no palette, no font, no layout,
//   and no styling for any screen", so nothing here reads a colour, a size, or
//   a position beyond the one relation the file states.
//
// THE DRIVE. A reset to the title and one frame. No key is pressed and no pose
// beyond the reset is made, so a build with a broken menu fails the navigation
// points and passes this one.
//
// THE TOLERANCE. The copy is compared as words in order, through `drewPhrase`,
// so a build that wraps a line, draws a shadow under its text, or marks the
// highlighted item passes while a build showing other words fails. The stacking
// is read as a strict inequality between the topmost anchor of each item, which
// admits any spacing, font, and alignment the build chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLessThan } from "../assert";
import { TAGLINE_TEXT, TITLE_ITEMS, TITLE_TEXT } from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  present,
  topAnchorOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws WICK, the tagline, and the two menu items stacked", async () => {
  h.reset();
  const { calls } = await h.frameDraw();
  captureStill(h, "title");

  const copy = [TITLE_TEXT, TAGLINE_TEXT, ...TITLE_ITEMS];
  assertDeepEqual(
    copy.filter((text) => !drewPhrase(calls, text)),
    [],
    "the copy specs/ui.md gives the title screen, missing from its frame",
  );

  const first = present(
    topAnchorOf(calls, TITLE_ITEMS[0]),
    `where the frame drew ${TITLE_ITEMS[0]}`,
  );
  const second = present(
    topAnchorOf(calls, TITLE_ITEMS[1]),
    `where the frame drew ${TITLE_ITEMS[1]}`,
  );
  assertLessThan(
    first,
    second,
    `${TITLE_ITEMS[0]} drawn above ${TITLE_ITEMS[1]}, in TITLE_ITEMS order`,
  );
});
