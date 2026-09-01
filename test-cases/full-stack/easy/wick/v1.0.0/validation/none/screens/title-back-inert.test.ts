// screens/title-back-inert — `back` does nothing on the title screen.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`title`"): "`confirm` takes the
// highlighted item, and `back` does nothing." specs/controls.md ("What each
// screen reads"): the `title` row names `up`, `down`, `confirm` and `mute` and
// no `back`, and "An action a row omits does nothing on that screen."
// specs/controls.md ("Actions and bindings"): "`back` | `Escape` | edge".
//
// WHY THE WORLD IS POSED AS IT IS. The highlight is moved off `0` with one
// `ArrowDown` before the press, because "does nothing" has to be told from
// "resets the screen": a build that sent `back` through the same path as an
// arrival would leave `menuIndex` `0` and pass against a title that was already
// there. The index is read back before the press, and the press is a REAL
// `Escape` held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressBack,
  pressDown,
  type Harness,
} from "../harness";
import { assertHighlight } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the title screen and its highlight where Escape found them", async () => {
  const title = await h.snapshot();
  assertEqual(title.screen, "title", "the screen the press is made on");
  const posed = await pressDown(h);
  assertEqual(
    posed.menuIndex,
    1,
    "menuIndex before the press, posed by one ArrowDown",
  );

  const after = await pressBack(h);
  await captureStill(h, "inert");

  assertHighlight(after, "title", 1, "after Escape on the title");
});
