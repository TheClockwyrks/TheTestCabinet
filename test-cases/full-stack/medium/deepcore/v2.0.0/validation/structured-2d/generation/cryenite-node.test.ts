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
import {
  MATERIAL_BAND,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  WORLD_SIZES,
  type WorldSize,
} from "../constants";
import { assertBetween, assertEqual, assertLength } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bandOf, generatedMine, look } from "./mine-scan";

/**
 * How many fresh mines each world size is swept over.
 *
 * `specs/world.md` divides the minable rows into four equal bands, so the rule
 * bites hardest at the shallowest row of the node's band: that is the one row an
 * off-by-one in a build's own range arithmetic puts the node a row outside the
 * band the specification states. That row is drawn rarely, and the shallower the
 * mine the fewer rows a band holds, so the Quick mine is where a boundary error
 * surfaces soonest and for the least work. The sweep is therefore wide at Quick
 * and narrower at the two deeper sizes, each of which costs proportionally more
 * to generate and read for the same one node.
 */
const MINES_PER_SIZE: Readonly<Record<WorldSize, number>> = {
  quick: 200,
  standard: 24,
  marathon: 12,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("generates exactly one Cryenite node, at a deepstone cell", async () => {
  let last: { col: number; row: number } | null = null;
  for (const size of WORLD_SIZES) {
    for (let mine = 1; mine <= MINES_PER_SIZE[size]; mine += 1) {
      const at = `the ${size} mine, generation ${mine}`;
      const scan = generatedMine(h, size);
      const nodes = scan.materials.filter(
        (cell) => cell.material === "cryenite",
      );
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
  }

  // The picture: the node standing in the deepstone of the mine last read.
  await look(h, last?.col ?? 16, last?.row ?? 310);
  captureStill(h, "node");
});
