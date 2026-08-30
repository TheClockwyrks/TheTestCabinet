// screens/howto-back-returns — the how-to screen's `BACK` returns to `title`.
//
// `specs/screens.md`, the `howto` screen: "The screen carries one control,
// labelled `HOWTO_BACK_LABEL` (`BACK`) and drawn inside the `HOWTO_BACK`
// rectangle. It returns to `title`." `specs/controls.md` fixes that rectangle at
// `{ x: 480, y: 600, w: 320, h: 52 }`, and fixes that a control answers a CLICK
// whose press point lies inside it.
//
// THE ROUTE IS DIRECT. The how-to screen is posed rather than reached by pressing
// the title's `HOW TO PLAY`, because a build whose way IN is broken must fail
// `screens/title-how-to-opens` and this item separately: routing through that
// control would fail both for one defect and say less about which.
//
// `specs/controls.md` also fixes that "A control answers only on the screen it
// belongs to", so this press lands on the how-to screen, where `HOWTO_BACK` is
// the only control there is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_BACK } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  rectCenter,
  type Harness,
} from "../harness";
import { openHowto } from "./screens";

/** The point pressed and released: the centre of the control's own rectangle. */
const PRESS = rectCenter(HOWTO_BACK);

/** One frame, so the canvas carries the screen the assertion read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title screen", async () => {
  await openHowto(h);
  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the check was posed on",
  );

  await clickAt(h, PRESS.x, PRESS.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen BACK returned to (specs/screens.md)",
  );
});
