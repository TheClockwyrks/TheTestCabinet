// generation/lava-none-above-the-deepstone — lava is first met at the deepstone.
//
// `specs/world.md` opens the lava ramp at the top of the deepstone and says
// "none appears above the deepstone", and its band table lists lava as a hazard
// of the deepstone and the coreshell alone. So the topsoil and the rockbed hold
// no lava cell at all, at any seed and any world size, and a prospector learning
// the game meets gas before it meets molten rock.
//
// A share within a tolerance is the wrong reading for this: the specification
// states none, so the count is held at zero rather than at a small number.

import { afterEach, beforeEach, it } from "vitest";
import { WORLD_SIZES } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bandRows, generatedMine, look, tallyBand } from "./mine-scan";

const SEEDS = [1, 2, 3, 7, 19] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts no lava cell in the topsoil or the rockbed", async () => {
  for (const size of WORLD_SIZES) {
    for (const seed of SEEDS) {
      const scan = generatedMine(h, seed, size);
      for (const band of ["topsoil", "rockbed"] as const) {
        const tally = tallyBand(scan, band);
        assertEqual(
          tally.kinds.lava,
          0,
          `${band} lava cells in the ${size} mine on seed ${seed}`,
        );
      }
    }
  }

  // The picture: the rockbed, with no lava in it.
  // The mine the page is left holding is the last one read, so its own `coreRow`
  // is what divides its bands.
  const rockbed = bandRows(h.snapshot().coreRow).rockbed;
  await look(h, 16, Math.round((rockbed.from + rockbed.to) / 2));
  captureStill(h, "upper");
});
