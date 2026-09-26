// controls/key-s-moves-highlight — KeyS moves the menu highlight like
// ArrowDown.
//
// specs/controls.md binds the `down` action to two keys, `ArrowDown` and
// `KeyS`, so KeyS fires the same action wherever `down` is read; on `title`,
// specs/screens.md has that action move the highlight "down one" entry. From
// the top entry of a freshly opened title, one KeyS press lands the highlight
// on entry `1`.
//
// Same arrangement as controls/arrow-down-moves-highlight with only the key
// changed: a build that bound only the arrow fails here and passes there,
// which is the separation the two points exist for.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { moveHighlight } from "./menu";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = BINDINGS.down[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the title highlight down one entry with KeyS", async () => {
  assertEqual(KEY, "KeyS", "the binding this point presses");
  const press = await moveHighlight(h, KEY, 0, "moved");
  assertEqual(
    press.after.menu.index,
    1,
    "the highlighted entry after one KeyS from the top",
  );
  assertEqual(press.after.screen, "title", "the screen after the press");
});
