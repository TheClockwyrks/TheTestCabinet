// sprites/component-base-sprites — a mount for each of the eight base types.
//
// `specs/assets.md`: `components/<type>/base.png` at `40 x 40`, "the fixed mount
// a head turns on, one per base type", where `<type>` is a base component's
// identifier. `specs/components.md` fixes those eight identifiers, the Regulator
// included, and `specs/yard.md` fixes the `2` by `2` footprint the `40 x 40`
// canvas covers.

import { it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
} from "../harness";
import { COMPONENT_TYPES } from "../constants";
import { canvasOf, componentBase } from "./png";

it("produces a mount for every base component type", async () => {
  for (const type of COMPONENT_TYPES) {
    const sprite = componentBase(type);
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
    openYard(h);
    let col = 6;
    for (const type of COMPONENT_TYPES) {
      standComponent(h, type, 1, col, 10);
      col += 3;
    }
    h.debug.clearSelection();
    await h.advance(1);
    captureStill(h, "mounts");
  } finally {
    h.dispose();
  }
});
