// screens/title-how-to-opens — the title's `HOW TO PLAY` moves to `howto`.
//
// `specs/screens.md`, the `title` screen's item table: "`HOW TO PLAY` — Moves to
// `howto`." `specs/controls.md` fixes the rectangle it answers inside,
// `TITLE_HOW_TO` at `{ x: 480, y: 516, w: 320, h: 52 }`, and fixes that a
// control is activated by a CLICK — a press with its release within
// `DRAG_THRESHOLD` of it.
//
// THE PRESS POINT IS THE DISTINGUISHING VALUE. `TITLE_NEW_GAME` sits directly
// above, ending at `y = 500`, and this rectangle begins at `y = 516`; the press
// is at the centre of this one, `(640, 542)`, which is `42` below that boundary.
// So a build that had the two rectangles swapped, or that treated the whole
// panel as one control, deals and reads as `playing` rather than reading as
// `howto` — a different answer, not a silent pass. The other item is
// `screens/title-new-game-enters-play`, and the table is left empty here so that
// a build which dealt by mistake is visible in the captured frame as well.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_HOW_TO } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  rectCenter,
  type Harness,
} from "../harness";
import { openTitle } from "./screens";

/** The point pressed and released: the centre of the control's own rectangle. */
const PRESS = rectCenter(TITLE_HOW_TO);

/** One frame, so the canvas carries the screen the assertion read. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the how-to screen", async () => {
  await openTitle(h);

  await clickAt(h, PRESS.x, PRESS.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "howto");

  assertEqual(
    (await h.snapshot()).screen,
    "howto",
    "the screen the title's HOW TO PLAY reached (specs/screens.md)",
  );
});
