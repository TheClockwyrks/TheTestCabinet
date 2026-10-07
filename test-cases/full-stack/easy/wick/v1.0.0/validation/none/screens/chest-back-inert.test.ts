// screens/chest-back-inert — `back` does nothing on the chest overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`chest`"): "`up`, `down`,
// `back`, and `pause` do nothing here", where the way out is stated one line
// above: "`confirm` closes the overlay ... `screen = playing`".
// specs/controls.md ("What each screen reads"), the `chest` row: "`confirm`
// closes the overlay; `mute`", and "An action a row omits does nothing on that
// screen." So the overlay stands and its result stays reported.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with an empty loadout, so
// the chest falls through to the heal, and the chest is reached the real way.
// The result is read before and after the press, because "does nothing" has to
// be told from "closes it": a build that answered `Escape` the way it answers
// `confirm` would leave `chestResult` `null`.
//
// THE TOLERANCE. None: a screen name, an index and a result's kind are exact
// comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressBack,
  type Harness,
} from "../harness";
import { assertHighlight, chestResultOf, night, openHealChest } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the chest overlay standing with its result after Escape", async () => {
  await night(h);
  const opened = await openHealChest(h);
  const before = chestResultOf(opened, "the collected chest");

  const after = await pressBack(h);
  await captureStill(h, "inert");

  assertHighlight(after, "chest", 0, "after Escape on the chest overlay");
  assertEqual(
    chestResultOf(after, "Escape on the chest overlay").kind,
    before.kind,
    "the result the overlay reports after Escape",
  );
});
