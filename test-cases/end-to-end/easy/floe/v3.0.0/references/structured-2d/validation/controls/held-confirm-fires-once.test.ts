// Floe — controls/held-confirm-fires-once: a confirm key held down confirms
// exactly once.
//
// `specs/controls.md`: "Confirm, back, pause, and mute are read as press edges
// everywhere, so each fires once per press however long the key is held." A
// second of a held confirm is one confirm.
//
// THE SCREEN IS READ ON EVERY FRAME OF THE HOLD, NOT AT ITS END, and that is the
// whole of the arrangement. `HOW TO PLAY` opens the how-to screen, and the how-to
// screen's own confirm returns to the title (`specs/ui.md`), so a build that
// repeated its confirm edge would BOUNCE between the two — and could perfectly
// well be back on `howto` when the hold ends. Reading only the last frame would
// pass exactly the build this point exists to catch, so every frame is read and
// every one of them must show `howto`.
//
// THE FIRST FRAME IS PART OF THE CLAIM. The confirm is delivered on the frame the
// key goes down, so the how-to screen is open from that frame onward and a build
// that answered nothing at all reads as `title` throughout.
//
// THE HIGHLIGHT IS POSED. `setMenuIndex` puts it on `HOW TO PLAY` rather than
// moving it there with a key, so a build whose menu keys are broken loses
// `controls.menu-down` and keeps this point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  ticksFor,
  type Harness,
} from "../harness";

/** The title entry the hold confirms: `HOW TO PLAY`, which opens a screen. */
const HOWTO_ITEM = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** The confirm key held down, from the case's own binding table. */
const CONFIRM_KEY = BINDINGS.confirm[0];

/** How long the key is held, in seconds of game time. */
const HOLD_SECONDS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the how-to screen and keeps it open through a second of held confirm", async () => {
  resetTo(h);
  h.debug.setMenuIndex(HOWTO_ITEM);

  const posed = h.snapshot();
  assertEqual(posed.screen, "title", "the reset opened the title screen");
  assertEqual(
    posed.menuIndex,
    HOWTO_ITEM,
    `the pose highlighted ${TITLE_ITEMS[HOWTO_ITEM]}`,
  );

  const held = ticksFor(HOLD_SECONDS);
  h.hold(CONFIRM_KEY);
  try {
    for (let tick = 1; tick <= held; tick += 1) {
      await h.advance(1);
      assertEqual(
        h.snapshot().screen,
        "howto",
        `the how-to screen on frame ${tick} of ${held}: a confirm fires once per ` +
          "press however long the key is held, so a held key can neither open " +
          "it late nor bounce back off it (specs/controls.md)",
      );
    }
  } finally {
    h.release(CONFIRM_KEY);
  }
  captureStill(h, "confirm");
});
