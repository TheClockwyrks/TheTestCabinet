// sprites/combination-tower-sprites — a mount and a head for each of the twelve.
//
// `specs/assets.md`: `combos/<id>/base.png` and `combos/<id>/head.png`, both at
// `40 x 40`, "one per tower", and "a tower has no tier variants" — so it is
// twenty-four files rather than the sixty a quality ladder would give.
// `specs/combinations.md` fixes the twelve identifiers.

import { it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, openYard, standCombo } from "../harness";
import { COMBO_IDS } from "../constants";
import { canvasOf, comboBase, comboHead } from "./png";

it("produces a mount and a head for every combination tower", async () => {
  for (const id of COMBO_IDS) {
    for (const sprite of [comboBase(id), comboHead(id)]) {
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
    await openYard(h);
    let col = 4;
    let row = 8;
    for (const id of COMBO_IDS) {
      await standCombo(h, id, col, row);
      col += 3;
      if (col > 22) {
        col = 4;
        row += 3;
      }
    }
    await h.debug.clearSelection();
    await h.advance(1);
    await captureStill(h, "towers");
  } finally {
    await h.dispose();
  }
});
