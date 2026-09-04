// screens/hud-menu-returns — the HUD's `MENU` returns to `title`.
//
// `specs/screens.md`, the HUD's table: "`MENU` | `HUD_ITEMS[1]` | Returns to
// `title`." `specs/controls.md` fixes how it is activated: one region holding
// both the press point and the release point. WHERE that region is is the
// build's, so the press is made at the middle of what
// `menuItemRect(HUD_MENU_ITEM)` answered with.
//
// THE ITEM INDEX IS THE DISTINGUISHING VALUE. The HUD's menu is `NEW GAME`,
// `MENU`, `SOUND` in that order, so a build that reported the strip's regions in
// another order deals a fresh game or flips `muted` instead of reaching the
// title, which reads as a different answer rather than as a quiet pass.
// `screens/hud-new-game-deals`, `screens/hud-sound-mutes` and
// `screens/hud-sound-unmutes` are the other three points over the same strip.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HUD_MENU_ITEM } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuPoint,
  openTable,
  type Harness,
} from "../harness";

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

  const press = await menuPoint(h, HUD_MENU_ITEM);
  await clickAt(h, press.x, press.y);
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen the HUD's MENU reached (specs/screens.md)",
  );
});
