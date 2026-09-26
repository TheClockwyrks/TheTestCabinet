// Deepcore — supplies/explosives-clear-stone: a charge opens unbreakable stone.
//
// `specs/items.md`: "Rock, ore, gemstone, lava, and unbreakable stone in the
// block all clear to tunnel. This is the only way through unbreakable stone."
// `specs/world.md` calls `stone` not minable, so nothing else in the game moves
// it.
//
// A boulder is posed inside the `3x3` Dynamite block, beside the miner's own
// cell, and read back as open tunnel after the charge. A second boulder is posed
// one cell further out, outside the block, and read back as the stone it was:
// what the charge cleared has to be the stone the block covered rather than every
// boulder in the mine.
//
// The scene sits in the rockbed, which is where `specs/world.md` first places
// unbreakable stone, so the boulders stand at a depth the mine really generates
// them at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DYNAMITE_RADIUS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { AFTERMATH_FRAMES, openBlastScene, ROCKBED_ROW } from "./blast-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears unbreakable stone caught inside the block", async () => {
  const centre = openBlastScene(h, ROCKBED_ROW);
  const inside = { col: centre.col + DYNAMITE_RADIUS, row: centre.row };
  const beyond = { col: centre.col + DYNAMITE_RADIUS + 1, row: centre.row };

  h.debug.setTile(inside.col, inside.row, "stone");
  h.debug.setTile(beyond.col, beyond.row, "stone");
  h.debug.setItemCount("dynamite", 1);

  assertEqual(
    h.tileAt(inside.col, inside.row).kind,
    "stone",
    "the boulder posed inside the block",
  );

  await captureReplay(h, "boulder", async () => {
    h.debug.useItem("dynamite");
    await h.advance(AFTERMATH_FRAMES);
  });

  assertEqual(
    h.tileAt(inside.col, inside.row).kind,
    "tunnel",
    "the boulder inside the block, after the charge",
  );
  assertEqual(
    h.tileAt(beyond.col, beyond.row).kind,
    "stone",
    "the boulder outside the block, after the charge",
  );
});
