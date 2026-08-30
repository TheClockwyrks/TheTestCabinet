// generation/topsoil-clear — the first band is safe to learn in.
//
// `specs/world.md` puts the topsoil at the top of every ramp and outside all
// three: unbreakable stone "none appears in the topsoil", gas pockets "none
// appears in the topsoil", lava "none appears above the deepstone". Its row of
// the band table lists its hazards as none and its gemstone as none. So the
// topsoil holds rock and ore and nothing else, and a player's first descent
// cannot meet a detonation, a burn, or a boulder it has no way past.
//
// Where the two material nodes sit is the business of `resonite-node` and
// `cryenite-node`, so it is not read again here.
//
// The reading is a count held at zero rather than a share within a tolerance,
// because the specification states none rather than few. It is taken across
// several seeds and every world size, since the topsoil is a quarter of the mine
// at each of them and the rule is every mine's.

import { afterEach, beforeEach, it } from "vitest";
import { WORLD_SIZES } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, look, tallyBand } from "./mine-scan";

const SEEDS = [1, 2, 3, 7, 19] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the topsoil holding only rock and ore", async () => {
  for (const size of WORLD_SIZES) {
    for (const seed of SEEDS) {
      const at = `the ${size} mine on seed ${seed}`;
      const tally = tallyBand(generatedMine(h, seed, size), "topsoil");
      assertEqual(tally.kinds.gas, 0, `topsoil gas pockets in ${at}`);
      assertEqual(tally.kinds.lava, 0, `topsoil lava cells in ${at}`);
      assertEqual(tally.kinds.stone, 0, `topsoil boulders in ${at}`);
    }
  }

  // The picture: the topsoil, holding nothing but rock and ore.
  await look(h, 16, 60);
  captureStill(h, "topsoil");
});
