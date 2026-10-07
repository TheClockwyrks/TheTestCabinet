// sprites/combination-towers-distinct — twelve towers, and none of them a component.
//
// `specs/overview.md`: "a combination tower is unmistakable beside a base
// component", and `specs/combinations.md` has each tower wear "an accent that is
// not worn by any base component, so it reads as a combination tower on sight",
// with "its look reads its dominant ability". `specs/assets.md` asks for one head
// per tower.
//
// So the twelve heads are held against each other and against all forty component
// heads: a tower that shares a head with another tower is a tower a player cannot
// name, and one that shares a head with a base component is exactly the thing the
// specification says must never happen.
//
// THE STILL IS EVIDENCE ONLY. The verdict is read off the files above the
// drive, so the pose that puts the yard beside them is guarded: a build whose
// debug surface cannot take the pose loses the picture and keeps the point,
// and no still is recorded over the un-posed frame.

import { it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, openYard, standCombo } from "../harness";
import { COMBO_IDS, COMPONENT_TYPES, TIERS } from "../constants";
import { comboHead, componentHead, decode, samePixels } from "./png";

it("draws twelve tower heads, each unlike every other and every component", async () => {
  const towers = COMBO_IDS.map((id) => ({ id, png: decode(comboHead(id)) }));
  for (let i = 0; i < towers.length; i += 1) {
    for (let j = i + 1; j < towers.length; j += 1) {
      assertEqual(
        samePixels(towers[i]!.png, towers[j]!.png),
        false,
        `whether assets/${comboHead(towers[i]!.id).path} and ` +
          `assets/${comboHead(towers[j]!.id).path} are the same image`,
      );
    }
  }

  const components = COMPONENT_TYPES.flatMap((type) =>
    TIERS.map((tier) => ({ sprite: componentHead(type, tier) })),
  ).map((one) => ({ sprite: one.sprite, png: decode(one.sprite) }));
  for (const tower of towers) {
    for (const component of components) {
      assertEqual(
        samePixels(tower.png, component.png),
        false,
        `whether assets/${comboHead(tower.id).path} and ` +
          `assets/${component.sprite.path} are the same image`,
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
  } catch (error) {
    // Evidence only; the readings above carry the verdict.
    console.warn(
      `arc foundry: could not pose the still for \`towers\`, so none is recorded: ${String(error)}`,
    );
  } finally {
    await h.dispose();
  }
});
