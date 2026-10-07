// presentation/gems-drawn-from-sprites — each gem tier is drawn from its own
// produced sprite.
//
// WHERE THE THRESHOLD COMES FROM. `specs/assets.md` — "The sprites": "Gems |
// `assets/sprites/gems/small.png`, `medium.png`, `large.png` | `draw` | `1` each
// | `8 x 8`, `12 x 12`, `16 x 16`", and "The three gem tiers are told apart by
// size and form." `specs/world.md` — "Gems" fixes the three tiers themselves,
// "`GEM_TIERS` lists the three tiers in this order", and `specs/ui.md` has the
// playing screen draw every gem "inside the view ... at its world position".
//
// WHY ALL THREE AT ONCE. The requirement is that a tier reaches the canvas as ITS
// OWN file, so a build that drew one sprite for every tier, or that mapped the
// tiers onto the files in another order, has to be caught by a frame that carries
// all three: a reading over one tier alone cannot see the swap.
//
// WHY THE WORLD IS POSED AS IT IS. An emptied night with every faculty held, and
// one gem of each tier posed `200` units out on three different bearings. `200`
// is far beyond `pickupRadius` (`48` with no Lure held), which `specs/world.md`
// makes the distance a gem becomes attracted at, so no gem flies toward the
// lamplighter before the frame is read, and none is collected.
//
// WHAT IS READ. The image drawn at each gem's own place, and which produced file
// it is, decided by the file's own pixels. The gems' sizes are another point's;
// this one is about which file each tier draws.
//
// THE TOLERANCE. `BLIT_TOL`, one logical unit on the centre, which is one device
// pixel at the harness's fit. The identity of the file has no tolerance.

import { afterEach, beforeEach, it } from "vitest";
import { GEM_TIERS, gemSprite } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeGem,
  stagePoint,
  type Harness,
} from "../harness";
import { drawFromAt } from "./readouts";
import { primeSources } from "./sources";

/** Where the three gems lie: well beyond attraction, and inside the view. */
const SLOTS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: -300, dy: -150 },
  { dx: 0, dy: 200 },
  { dx: 300, dy: -150 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each gem tier from the produced sprite its row names", async () => {
  const posed = await isolate(h);
  await primeSources(
    h,
    GEM_TIERS.map((tier) => gemSprite(tier)),
  );

  const at = posed.run.player;
  const placed = [];
  for (const [index, tier] of GEM_TIERS.entries()) {
    const slot = SLOTS[index]!;
    placed.push({
      tier,
      gem: await placeGem(h, tier, at.x + slot.dx, at.y + slot.dy),
    });
  }

  const snapshot = await h.step(1);
  const calls = await h.lastCalls();
  await captureStill(h, "gems");

  for (const { tier, gem } of placed) {
    await drawFromAt(
      h,
      calls,
      [gemSprite(tier)],
      stagePoint(snapshot, gem.x, gem.y),
      `the produced ${tier} gem sprite (${gemSprite(tier)})`,
    );
  }
});
