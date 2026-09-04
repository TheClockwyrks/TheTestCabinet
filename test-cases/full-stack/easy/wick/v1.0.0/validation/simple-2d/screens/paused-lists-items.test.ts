// screens/paused-lists-items — the pause menu lists its two items.
//
// WHAT THIS DECIDES. One thing: the two names of `PAUSE_ITEMS` are on the pause
// frame, stacked one above the next in the order the specification gives them.
// The heading and the HUD the same frame carries are `paused-copy`'s point, and
// what each item DOES is `paused-confirm-resume`'s and
// `paused-confirm-main-menu`'s.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`paused`): "The world held still, with the HUD, under
//   `PAUSED_TEXT` (`PAUSED`), and the menu `PAUSE_ITEMS` below it: `RESUME`,
//   `MAIN MENU`, in that order."
//   specs/ui.md ("Presentation"): "Wick fixes no palette, no font, and no
//   styling for any screen, and each screen's layout is yours except where a
//   table below places one element relative to another", so nothing here reads
//   a colour, a size, or a position beyond the one relation the file states.
//
// THE DRIVE. An isolated `playing` run paused through `setScreen("paused")`,
// which enters the screen "Exactly as `pause` does" (specs/instrumentation.md),
// so a build with a broken pause key fails its own point and not this one. One
// frame is drawn and its runs of text are read; no key is pressed, so the menu
// is read as the screen arrives with it.
//
// THE TOLERANCE. Each name is matched as its words in order through
// `drewPhrase`, case ignored, which admits any font, layout, line wrap, or
// selection marker a build draws around it. The stacking is read as a strict
// inequality between the topmost anchor of each name, which admits any spacing
// and alignment the build chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThan } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  isolate,
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

it("draws RESUME and MAIN MENU stacked in PAUSE_ITEMS order", async () => {
  isolate(h);
  h.debug.setScreen("paused");
  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the frame is read from");

  const { calls } = await h.frameDraw();
  captureStill(h, "menu");

  assertDeepEqual(
    PAUSE_ITEMS.filter((item) => !drewPhrase(calls, item)),
    [],
    "the items specs/ui.md gives the pause menu, missing from its frame",
  );

  const first = present(
    topAnchorOf(calls, PAUSE_ITEMS[0]),
    `where the frame drew ${PAUSE_ITEMS[0]}`,
  );
  const second = present(
    topAnchorOf(calls, PAUSE_ITEMS[1]),
    `where the frame drew ${PAUSE_ITEMS[1]}`,
  );
  assertLessThan(
    first,
    second,
    `${PAUSE_ITEMS[0]} drawn above ${PAUSE_ITEMS[1]}, in PAUSE_ITEMS order`,
  );
});
