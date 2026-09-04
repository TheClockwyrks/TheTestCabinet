// sprites/component-head-sprites — forty heads, eight types by five tiers.
//
// `specs/assets.md`: `components/<type>/head-<tier>.png` at `40 x 40`, "the
// rotating head, one per base type per tier: eight types by five tiers, forty
// sprites", with `<tier>` running `1` through `5`. It adds that "the Regulator
// never fires, so its head is a static aura emitter with no muzzle, drawn across
// its five tiers like every other type", so the Regulator's five are part of the
// forty rather than an exception to them.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  TIERS,
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { COMPONENT_TYPES } from "../../src/constants";
import { canvasOf, componentHead } from "./png";
import { serveProducedAssets } from "./host";

// The produced files, served to the engine off disk, so the still beside this
// point's verdict shows the art the run made rather than the fallback a build
// draws when nothing arrived.
serveProducedAssets();

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
  } finally {
    h.dispose();
  }
});
