// Wick — screens/paused-lists-items: the pause menu draws both of its items,
// one above the next, in the order `PAUSE_ITEMS` lists them.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`paused`": "The
// world held still, with the HUD, under `PAUSED_TEXT` (`PAUSED`), and the menu
// `PAUSE_ITEMS` below it: `RESUME`, `MAIN MENU`, in that order."
//
// WHAT IS READ, AND WHY. The strings the paused frame drew, and where it drew
// the two menu items. `specs/ui.md`, Presentation, leaves the palette, the
// font, the layout and the styling to the build, so the reading is which copy
// appeared and which of the two items sits higher on the stage; a run of text
// is matched as a SUBSTRING, so a build that marks its highlighted item
// (`> RESUME <`) or pads its lines still reads as having drawn the copy. That
// the heading, the HUD and the frozen world are drawn is
// `screens/paused-copy`'s point.
//
// THE DRIVE. An isolated `playing` world, paused through `setScreen("paused")`
// — which `specs/instrumentation.md` says enters the screen by setting `screen`
// alone, with the run left as it stands — and one frame. Nothing is pressed:
// the menu is what the screen draws on arriving.
//
// THE TOLERANCE. The strings are exact, ignoring case and surrounding
// characters. The stacking is strict: the first item's topmost anchor is
// ABOVE the second's, with no slack, since two items drawn at one height are
// not one above the next.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNotNull,
  assertTrue,
} from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  placedRuns,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { anchorY } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws RESUME above MAIN MENU on the pause screen", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the frame is read on");

  const { calls } = await h.frameDraw();
  captureStill(h, "menu");

  for (const item of PAUSE_ITEMS) {
    assertTrue(
      drewText(calls, item),
      `the pause screen drew ${JSON.stringify(item)} (specs/ui.md, paused)`,
    );
  }

  const draws = placedRuns(calls);
  const first = anchorY(draws, PAUSE_ITEMS[0]);
  const second = anchorY(draws, PAUSE_ITEMS[1]);
  assertNotNull(first, `where ${PAUSE_ITEMS[0]} was drawn`);
  assertNotNull(second, `where ${PAUSE_ITEMS[1]} was drawn`);
  assertLessThan(
    first as number,
    second as number,
    `${PAUSE_ITEMS[0]} listed above ${PAUSE_ITEMS[1]}, in device pixels down the stage`,
  );
});
