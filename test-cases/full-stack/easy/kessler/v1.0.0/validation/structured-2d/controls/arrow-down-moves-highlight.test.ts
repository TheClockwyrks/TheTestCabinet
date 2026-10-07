// controls/arrow-down-moves-highlight — ArrowDown moves the menu highlight
// down one entry.
//
// specs/controls.md binds `ArrowDown` to `down` and, on `title`, has "`up` and
// `down` move the highlight". specs/screens.md fixes the motion: "`down` moves
// it down one" — so from the top entry of a freshly opened title, one press
// lands the highlight on entry `1`.
//
// Exactly one press from entry `0`, where a reset leaves the highlight, so
// nothing but the key under test has moved it. One entry and no further: a
// build that jumped to the end of the menu lands on the same entry of this
// two-entry menu, but one that left the highlight where it was, or left the
// screen, fails here by the readings below.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { moveHighlight } from "./menu";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = BINDINGS.down[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title highlight down one entry with ArrowDown", async () => {
  assertEqual(KEY, "ArrowDown", "the binding this point presses");
  const press = await moveHighlight(h, KEY, 0, "moved");
  assertEqual(
    press.after.menu.index,
    1,
    "the highlighted entry after one ArrowDown from the top",
  );
  assertEqual(press.after.screen, "title", "the screen after the press");
});
