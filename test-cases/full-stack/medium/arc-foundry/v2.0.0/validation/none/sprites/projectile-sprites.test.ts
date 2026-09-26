// sprites/projectile-sprites — a shot for each of the seven firing types.
//
// `specs/assets.md`: `projectiles/<type>.png` at `12 x 12`, "the travelling shot,
// one per firing base type: seven sprites", adding that "a combination tower's
// shot reuses the sprite of the base type its dominant output matches", so the
// twelve towers add none. `specs/components.md` names the one type that does not
// fire — the Regulator "has no range, no damage, no firing head, no projectile"
// — so `FIRING_TYPES` is the seven.
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
  parkUnit,
  standComponent,
} from "../harness";
import { FIRING_TYPES, structureCenter } from "../constants";
import { canvasOf, projectile } from "./png";

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
    await openYard(h, { wave: 30 });
    await standComponent(h, "capacitor", 5, 10, 10);
    const center = structureCenter(10, 10);
    await parkUnit(h, "dynamo", { x: center.x + 110, y: center.y });
    await h.advanceSeconds(0.5);
    await h.debug.clearSelection();
    await captureStill(h, "shots");
  } catch (error) {
    // Evidence only; the readings above carry the verdict.
    console.warn(
      `arc foundry: could not pose the still for \`shots\`, so none is recorded: ${String(error)}`,
    );
  } finally {
    await h.dispose();
  }
});
