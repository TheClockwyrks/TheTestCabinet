// controls/arrow-up-moves-highlight — ArrowUp moves the menu highlight up one
// entry.
//
// specs/controls.md binds `ArrowUp` to `up` and, on `title`, has "`up` and
// `down` move the highlight". specs/screens.md fixes the motion: "`up` moves
// the highlight up one entry" — so from the lower of the title's two entries,
// one press lands the highlight back on entry `0`.
//
// The press is made from entry `1`, because a freshly opened menu highlights
// `0` and moving up from a LOWER entry is the plain, non-wrapping reading of
// the rule (the wrap is its own point elsewhere). The route to entry `1` is
// one ArrowDown — the only route the surface allows, as menu.ts states. On a
// two-entry menu either direction lands on the other entry; what this point
// decides, in one direction, is that ArrowUp moves the highlight one entry as
// the rule words it, from a lower entry to the one above.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { moveHighlight } from "./menu";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = KEYS.up[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title highlight up one entry with ArrowUp", async () => {
  assertEqual(KEY, "ArrowUp", "the binding this point presses");
  const press = await moveHighlight(h, KEY, 1, "moved");
  assertEqual(
    press.after.menu.index,
    0,
    "the highlighted entry after one ArrowUp from entry 1",
  );
  assertEqual(press.after.screen, "title", "the screen after the press");
});
