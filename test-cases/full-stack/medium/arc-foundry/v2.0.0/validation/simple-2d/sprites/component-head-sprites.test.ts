// sprites/component-head-sprites — forty heads, eight types by five tiers.
//
// `specs/assets.md`: `components/<type>/head-<tier>.png` at `40 x 40`, "the
// rotating head, one per base type per tier: eight types by five tiers, forty
// sprites", with `<tier>` running `1` through `5`. It adds that "the Regulator
// never fires, so its head is a static aura emitter with no muzzle, drawn across
// its five tiers like every other type", so the Regulator's five are part of the
// forty rather than an exception to them.
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
import { COMPONENT_TYPES, TIERS } from "../constants";
import { canvasOf, componentHead } from "./png";

it("produces a head for every type at every quality tier", async () => {
  for (const type of COMPONENT_TYPES) {
    for (const tier of TIERS) {
      const sprite = componentHead(type, tier);
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
  }

  const h = await createHarness();
  try {
    openYard(h);
    let col = 6;
    for (const tier of TIERS) {
      standComponent(h, "capacitor", tier, col, 10);
      col += 3;
    }
    h.debug.clearSelection();
    await h.advance(1);
    captureStill(h, "heads");
  } catch (error) {
    // Evidence only; the readings above carry the verdict.
    console.warn(
      `arc foundry: could not pose the still for \`heads\`, so none is recorded: ${String(error)}`,
    );
  } finally {
    h.dispose();
  }
});
