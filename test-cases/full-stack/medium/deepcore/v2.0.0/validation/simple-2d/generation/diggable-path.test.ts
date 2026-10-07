// generation/diggable-path — a route down that needs no lava and no explosives.
//
// `specs/world.md` states it as a property of every generated mine, at every size
// in every generated mine: "From the cave mouth there is a path to each material node and
// to the Core that crosses only minable cells that are neither lava nor
// unbreakable stone, so a route down is always diggable without drilling lava or
// blasting a boulder."
//
// WHAT A CELL A ROUTE MAY CROSS IS. The sentence names it: a minable cell that is
// neither lava nor unbreakable stone — rock, ore, a material node, a gas pocket —
// and an already open tunnel, which is what the cave mouth itself is and what
// every cell a route crosses becomes once it is drilled. Bedrock, unbreakable
// stone, and lava are what a route may not cross. The Core tile is not minable,
// so what the route has to reach is the cell above it, which is where a downward
// cut onto the Core is taken from.
//
// The route is read as an orthogonal one, cell by cell, because that is the shape
// of a dug shaft: the drill cuts down, left, or right and never diagonally.

import { afterEach, beforeEach, it } from "vitest";
import { CAVE_MOUTH_COL, CORE_COL, WORLD_SIZES } from "../constants";
import { assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  type TileKind,
} from "../harness";
import { cellKey, generatedMine, look, reachableFrom } from "./mine-scan";

/** The cells a dug route may cross: minable, and neither lava nor boulder. */
function diggable(kind: TileKind): boolean {
  return (
    kind === "rock" ||
    kind === "ore" ||
    kind === "material" ||
    kind === "gas" ||
    kind === "tunnel"
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("runs a diggable route from the cave mouth to both nodes and the Core", async () => {
  for (const size of WORLD_SIZES) {
    const at = `the ${size} mine`;
    const scan = generatedMine(h, size);
    const reached = reachableFrom(
      scan,
      { col: CAVE_MOUTH_COL, row: 1 },
      diggable,
    );

    assertLength(scan.materials, 2, `material nodes in ${at}`);
    for (const node of scan.materials) {
      assertTrue(
        reached.has(cellKey(node.col, node.row)),
        `a diggable route from the cave mouth to the ${node.material} node at (${node.col}, ${node.row}) in ${at}`,
      );
    }
    // The Core is drilled downward onto from the cell above it, and that cell
    // is what a route has to reach; the Core tile itself is not minable.
    assertTrue(
      reached.has(cellKey(CORE_COL, scan.coreRow - 1)),
      `a diggable route from the cave mouth to the cell above the Core in ${at}`,
    );
  }

  // The picture: the route's start, at the edge of the camp.
  await look(h, CAVE_MOUTH_COL, 4);
  captureStill(h, "route");
});
