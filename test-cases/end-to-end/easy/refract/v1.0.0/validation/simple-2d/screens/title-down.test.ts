// Refract — screens/title-down: one down press moves the title selection from
// the first item to the second.
//
// One transition of the menu state machine specs/ui.md fixes: `up` and `down`
// move the highlight by one item. The press is a real key event at the target
// the engine listens on — the first key BINDINGS binds to the `down` action —
// so the action is raised by the binding the build declares, and the result is
// read back off the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("one down press moves menuIndex from 0 to 1", async () => {
  await resetTo(h);
  assertEqual(
    h.snapshot().menuIndex,
    0,
    "posing: menuIndex is 0 on arriving at the title (specs/ui.md)",
  );

  await tapAction(h, "down");
  captureStill(h, "menu");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "title",
    "down moves the highlight and leaves the screen (specs/ui.md)",
  );
  assertEqual(
    snapshot.menuIndex,
    1,
    "one down press sets menuIndex to 1 (specs/ui.md)",
  );
});
