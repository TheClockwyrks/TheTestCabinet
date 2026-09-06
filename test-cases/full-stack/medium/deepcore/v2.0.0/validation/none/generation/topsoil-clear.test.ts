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
// several fresh mines and every world size, since the topsoil is a quarter of the mine
// at each of them and the rule is every mine's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WORLD_SIZES, type WorldSize } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { generatedMine, look, tallyBand } from "./mine-scan";

const MINES = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the topsoil holding only rock and ore", async () => {
  for (const size of WORLD_SIZES) {
    for (let mine = 1; mine <= MINES; mine += 1) {
      const at = `the ${size} mine, generation ${mine}`;
      const tally = tallyBand(
        await generatedMine(h, size as WorldSize),
        "topsoil",
      );
      assertEqual(tally.kinds.gas, 0, `topsoil gas pockets in ${at}`);
      assertEqual(tally.kinds.lava, 0, `topsoil lava cells in ${at}`);
      assertEqual(tally.kinds.stone, 0, `topsoil boulders in ${at}`);
    }
  }

  // The picture: the topsoil, holding nothing but rock and ore.
  await look(h, 16, 60);
  await captureStill(h, "topsoil");
});
