// screens/hud-menu-returns — the HUD's `MENU` returns to `title`.
//
// `specs/screens.md`, the HUD's table: "`MENU` | `HUD_ITEMS[1]` | `HUD_MENU` |
// Returns to `title`." `specs/controls.md` fixes the rectangle at
// `{ x: 420, y: 680, w: 120, h: 36 }` and fixes that a control answers a click
// whose press point lies inside it.
//
// THE PRESS POINT IS THE DISTINGUISHING VALUE. All three HUD rectangles sit side
// by side in one strip — `HUD_NEW_GAME` ends at `x = 404`, this one runs
// `420..540`, and `HUD_SOUND` begins at `556` — so the press at this rectangle's
// centre, `(480, 698)`, is `60` from either neighbor's nearest edge. A build
// that mapped the strip to the wrong control deals a fresh game or flips `muted`
// instead of reaching the title, which reads as a different answer rather than as
// a quiet pass. `screens/hud-new-game-deals` and `screens/hud-sound-toggles` are
// those two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_MENU } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  openTable,
  rectCenter,
  type Harness,
} from "../harness";

/** The point pressed and released: the centre of the control's own rectangle. */
const PRESS = rectCenter(HUD_MENU);

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
  await openTable(h);

  await clickAt(h, PRESS.x, PRESS.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the HUD's MENU reached (specs/screens.md)",
  );
});
