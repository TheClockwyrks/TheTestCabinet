// sprites/icon-sprites — the ten marks the bar and the panel are drawn with.
//
// `specs/assets.md`: `icons/charge.png` and `icons/integrity.png` at `16 x 16`,
// "the status bar's Charge mark" and "its Grid Integrity mark", and
// `icons/type-<type>.png` at `16 x 16`, "one glyph per base component type, for
// the panel" — eight of them, so ten in all. `specs/hud.md` is what asks for
// them: the bar's Charge and Grid Integrity reads each carry an icon.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { ICON_SPRITES, canvasOf } from "./png";
import { serveProducedAssets } from "./host";

// The produced files, served to the engine off disk, so the still beside this
// point's verdict shows the art the run made rather than the fallback a build
// draws when nothing arrived.
serveProducedAssets();

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
    openYard(h, { charge: 473 });
    const id = standComponent(h, "capacitor", 3, 10, 10);
    h.debug.select(id);
    await h.advance(1);
    captureStill(h, "icons");
  } finally {
    h.dispose();
  }
});
