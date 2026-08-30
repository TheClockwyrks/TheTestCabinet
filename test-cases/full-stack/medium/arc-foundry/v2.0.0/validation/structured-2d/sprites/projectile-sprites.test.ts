// sprites/projectile-sprites — a shot for each of the seven firing types.
//
// `specs/assets.md`: `projectiles/<type>.png` at `12 x 12`, "the travelling shot,
// one per firing base type: seven sprites", adding that "a combination tower's
// shot reuses the sprite of the base type its dominant output matches", so the
// twelve towers add none. `specs/components.md` names the one type that does not
// fire — the Regulator "has no range, no damage, no firing head, no projectile"
// — so `FIRING_TYPES` is the seven.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  FIRING_TYPES,
  captureStill,
  createHarness,
  openYard,
  parkUnit,
  standComponent,
  structureCenter,
} from "../harness";
import { canvasOf, projectile } from "./png";
import { serveProducedAssets } from "./host";

// The produced files, served to the engine off disk, so the still beside this
// point's verdict shows the art the run made rather than the fallback a build
// draws when nothing arrived.
serveProducedAssets();

it("produces a projectile for every firing base type", async () => {
  for (const type of FIRING_TYPES) {
    const sprite = projectile(type);
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
    openYard(h, { wave: 30 });
    standComponent(h, "capacitor", 5, 10, 10);
    const center = structureCenter(10, 10);
    parkUnit(h, "dynamo", { x: center.x + 110, y: center.y });
    await h.advanceSeconds(0.5);
    h.debug.clearSelection();
    // The one frame that draws the yard with nothing selected, so the still is
    // of the shots in flight rather than of a range ring over them.
    await h.advance(1);
    captureStill(h, "shots");
  } finally {
    h.dispose();
  }
});
