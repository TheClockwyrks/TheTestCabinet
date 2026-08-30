// screens/howto-back-returns — the how-to screen's BACK returns to the title.
//
// THE RULE. specs/screens.md's `howto` section: "The screen carries one control,
// labelled `HOWTO_BACK_LABEL` (`BACK`) and drawn inside the `HOWTO_BACK`
// rectangle. It returns to `title`." specs/controls.md fixes that rectangle as
// `{ x: 480, y: 600, w: 320, h: 52 }` and states that a control answers a CLICK
// whose press point lies inside it.
//
// THE SCREEN IS POSED DIRECTLY with `setScreen("howto")`, which changes nothing
// else (specs/instrumentation.md). Reaching it through the title's `HOW TO PLAY`
// first would fold `screens/title-how-to-opens`'s requirement into this verdict:
// a build whose way IN is broken and whose way OUT works must lose one point and
// keep the other.
//
// DRIVEN THROUGH THE ENGINE'S OWN POINTER. {@link tapPointer} dispatches a real
// press and release at the rectangle's center and runs the one frame that delivers
// both, so what is exercised is the player's path.
//
// `clearTable` empties the piles the specification lets show behind a screen:
// nothing this point reads concerns a card.

import { afterEach, beforeEach, it } from "vitest";
import { HOWTO_BACK } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  tapPointer,
  type Harness,
} from "../harness";

/** A point inside `HOWTO_BACK`: its center (specs/controls.md). */
const PRESS = {
  x: HOWTO_BACK.x + HOWTO_BACK.w / 2,
  y: HOWTO_BACK.y + HOWTO_BACK.h / 2,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches the title screen when BACK is clicked on the how-to screen", async () => {
  h.debug.setScreen("howto");
  h.debug.clearTable();
  assertEqual(
    h.snapshot().screen,
    "howto",
    "posing: the game is on the how-to screen, where HOWTO_BACK answers " +
      "(specs/controls.md: a control answers only on the screen it belongs to)",
  );

  await tapPointer(h, PRESS.x, PRESS.y);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen after a click inside HOWTO_BACK (specs/screens.md)",
  );
});
