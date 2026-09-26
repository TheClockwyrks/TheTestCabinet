// sprites/icon-sprites — the ten marks the bar and the panel are drawn with.
//
// `specs/assets.md`: `icons/charge.png` and `icons/integrity.png` at `16 x 16`,
// "the status bar's Charge mark" and "its Grid Integrity mark", and
// `icons/type-<type>.png` at `16 x 16`, "one glyph per base component type, for
// the panel" — eight of them, so ten in all. `specs/hud.md` is what asks for
// them: the bar's Charge and Grid Integrity reads each carry an icon.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files above the
// drive, so the pose that puts the yard beside them is guarded: a build whose
// debug surface cannot take the pose loses the picture and keeps the point,
// and no still is recorded over the un-posed frame.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { ICON_SPRITES, canvasOf } from "./png";

it("produces the bar's and the panel's icons at sixteen square", async () => {
  for (const sprite of ICON_SPRITES) {
    const canvas = canvasOf(sprite);
    assertEqual(
      canvas.width,
      sprite.width,
      `the width of assets/${sprite.path}`,
    );
    assertEqual(
      canvas.height,
      sprite.height,
      `the height of assets/${sprite.path}`,
    );
  }

  const h = await createHarness();
  try {
    await openYard(h, { charge: 473 });
    const id = await standComponent(h, "capacitor", 3, 10, 10);
    await h.debug.select(id);
    await h.advance(1);
    await captureStill(h, "icons");
  } catch (error) {
    // Evidence only; the readings above carry the verdict.
    console.warn(
      `arc foundry: could not pose the still for \`icons\`, so none is recorded: ${String(error)}`,
    );
  } finally {
    await h.dispose();
  }
});
