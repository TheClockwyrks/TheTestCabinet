// controls/key-w-moves-highlight — KeyW moves the menu highlight like ArrowUp.
//
// specs/controls.md binds the `up` action to two keys, `ArrowUp` and `KeyW`,
// so KeyW fires the same action wherever `up` is read; on `title`,
// specs/screens.md has that action move "the highlight up one entry". From
// the lower of the title's two entries, one KeyW press lands the highlight
// back on entry `0`.
//
// Same arrangement as controls/arrow-up-moves-highlight with only the key
// changed: a build that bound only the arrow fails here and passes there,
// which is the separation the two points exist for. The route to entry `1` is
// one ArrowDown — `down`'s primary key, and the only route the surface allows
// to a lower entry, as menu.ts states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { openHarness, type Harness } from "../harness";
import { moveHighlight } from "./menu";

/** The key this point is about, as `specs/controls.md` binds it. */
const KEY = BINDINGS.up[1];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("moves the title highlight up one entry with KeyW", async () => {
  assertEqual(KEY, "KeyW", "the binding this point presses");
  const press = await moveHighlight(h, KEY, 1, "moved");
  assertEqual(
    press.after.menu.index,
    0,
    "the highlighted entry after one KeyW from entry 1",
  );
  assertEqual(press.after.screen, "title", "the screen after the press");
});
