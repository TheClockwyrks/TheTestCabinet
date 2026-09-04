// generation/no-band-sealed — every band can be crossed.
//
// `specs/world.md`: "No band is sealed across its full width by lava or
// unbreakable stone." What that guarantees a prospector is that the descent is
// never blocked outright: whichever band it is in, a way through to the band
// below exists that neither drills lava nor needs a boulder blasted.
//
// HOW THE PROPERTY IS READ. A band is crossed when an orthogonal route runs from
// some cell of its topmost row to some cell of its deepest row, staying inside
// that band's rows and crossing only cells a drill can clear: rock, ore, a
// material node, a gas pocket, or already open tunnel. Lava, unbreakable stone,
// and the bedrock border are what a route may not cross. Reading each band on its
// own is what makes this the band's property rather than the whole mine's — a
// route from the cave mouth all the way down is `diggable-path`, and a band that
// seals under a band that is already sealed above it would hide behind that one.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  BAND_ORDER,
  WORLD_SIZES,
  type TileKind,
  type WorldSize,
} from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { bandRows, generatedMine, look, routeExists } from "./mine-scan";

const SEEDS = [1, 2, 3, 7, 19] as const;

/** The cells a dug route may cross, as `specs/world.md` names them. */
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

afterEach(async () => {
  await h.dispose();
});

it("leaves a way through every band, at every seed and every size", async () => {
  for (const size of WORLD_SIZES) {
    for (const seed of SEEDS) {
      const scan = await generatedMine(h, seed, size as WorldSize);
      const spans = bandRows(scan.coreRow);
      for (const band of BAND_ORDER) {
        const { from, to } = spans[band];
        assertTrue(
          routeExists(scan, from, to, diggable),
          `a way through the ${band} (rows ${from}-${to}) of the ${size} mine on seed ${seed}`,
        );
      }
    }
  }

  // The picture: one band with a way through it.
  await look(h, 16, 300);
  await captureStill(h, "band");
});
