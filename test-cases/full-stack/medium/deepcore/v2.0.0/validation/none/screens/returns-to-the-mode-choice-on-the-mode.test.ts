// screens/returns-to-the-mode-choice-on-the-mode — the mode choice arrives on the
// mode the expedition is set to.
//
// `specs/ui.md`, "Returning to a menu": `mode-select` arrived at from
// `size-select`, by `BACK` or `pause`, selects "the entry of the mode the
// expedition is set to, `STANDARD` or `HARDCORE`". A player who steps back from
// the size choice finds the cursor on the mode they had already picked rather
// than at the top of the list.
//
// BOTH MODES, because the requirement is that the selection FOLLOWS the mode: a
// build that highlights the first entry passes on Standard alone, and a build
// that highlights the second passes on Hardcore alone. The two values exercise
// one rule the same way, so they share this point.
//
// THE MODE IS SET THROUGH THE SURFACE. `specs/instrumentation.md`'s `setMode`
// sets "The expedition's mode", which is the phrase the rule is written over, so
// the mode this reads back against is the one the game says it holds. Reaching
// `size-select` by choosing a mode on the mode choice is
// `screens/mode-to-size-select`'s point, and stepping back at all is
// `screens/size-select-back`'s.
//
// ISOLATION. The size choice posed directly through the surface, so a build with
// a broken mode choice fails its own points rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODES, MODE_ITEMS, SIZE_ITEMS } from "../constants";
import {
  ACTION_KEY,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The entry each mode is named by, as `MODE_ITEMS` lists them. */
const MODE_ENTRY = { standard: "STANDARD", hardcore: "HARDCORE" } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights the expedition's own mode on the mode choice stepped back to", async () => {
  await h.debug.setAutoStep(false);

  for (const mode of MODES) {
    await h.debug.reset();
    await h.debug.setMode(mode);
    await h.debug.setScreen("size-select");
    await h.debug.setMenuIndex(SIZE_ITEMS.indexOf("BACK"));

    await h.tap(ACTION_KEY.activate);
    if (mode === "hardcore") await captureStill(h, "selected");

    const back = await h.snapshot();
    assertEqual(
      back.screen,
      "mode-select",
      "specs/ui.md: BACK on size-select returns to mode-select",
    );
    assertEqual(
      back.menuIndex,
      MODE_ITEMS.indexOf(MODE_ENTRY[mode]),
      `specs/ui.md: the mode choice stepped back to selects ${MODE_ENTRY[mode]}`,
    );
  }
});
