// generation/cryenite-node — one Cryenite node, in the deepstone, in every mine.
//
// `specs/world.md`: "exactly one Cryenite node exists, at a random minable cell
// of the deepstone band ... Neither sits at a fixed cell, and both are always
// present." `specs/mining.md` names the node as the only source of Cryenite and
// `specs/rocket.md` spends Cryenite on the thruster, so a mine generated without
// one cannot be escaped. That is why the point fails a build outright rather than
// by degrees.
//
// Three things are read, and they are the three the sentence states: that there
// is exactly one such node, that it stands in the deepstone, and that it stands
// in the playable field where a prospector can reach it. The Resonite node has
// its own point.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import {
  MATERIAL_BAND,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  WORLD_SIZES,
  type WorldSize,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { bandOf, generatedMine, look } from "./mine-scan";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("generates exactly one Cryenite node, at a deepstone cell", async () => {
  let last: { col: number; row: number } | null = null;
  for (const size of WORLD_SIZES) {
    const at = `the ${size} mine`;
    const scan = await generatedMine(h, size as WorldSize);
    const nodes = scan.materials.filter((cell) => cell.material === "cryenite");
    assertLength(nodes, 1, `Cryenite nodes in ${at}`);
    const node = nodes[0];
    assertEqual(
      bandOf(scan, node.row),
      MATERIAL_BAND.cryenite,
      `the band of the Cryenite node in ${at}`,
    );
    assertBetween(
      node.col,
      PLAYABLE_COL_MIN,
      PLAYABLE_COL_MAX,
      `the column of the Cryenite node in ${at}`,
    );
    last = node;
  }

  // The picture: the node standing in the deepstone of the mine last read.
  await look(h, last?.col ?? 16, last?.row ?? 310);
  await captureStill(h, "node");
});
