// Deepcore — supplies/matter-transmitter-lands-clean: the transmitter sets the
// miner down without a scratch.
//
// `specs/items.md`: "The Matter Transmitter places the miner standing on the camp
// ground at zero velocity, with no impact." That is the whole of what its price
// buys over the Quantum Teleporter, so the three readings are one requirement:
// the miner's feet on the camp ground line, both velocity components at zero, and
// the hull exactly what it was.
//
// It is used from deep underground and read on the call itself, before a frame
// runs, so what is measured is where the item put the miner. The hull is posed
// part-spent rather than full, because a hull already at its maximum could not
// show a repair and could only show damage — and this check must be able to see
// either. The scene is then run on for a moment and read again: a build that
// placed the miner correctly and then let it drop through the camp, or billed a
// landing a frame later, fails on the second reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { MINER_H, SURFACE_Y } from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** The floor the miner is transmitted away from, well underground. */
const DEEP_COL = 10;
const DEEP_FLOOR_ROW = 30;

/** A hull part spent, so a repair or a knock either way would show. */
const POSED_HULL = 60;

/** Frames the placement is watched settling. */
const SETTLE_FRAMES = 60;

/** A world unit of slack on the ground line. */
const EPSILON = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the miner on the camp ground at rest and costs no hull", async () => {
  await openScene(h);
  await layFloor(h, 1);
  await layFloor(h, DEEP_FLOOR_ROW);
  await pinDrill(h);
  await standOn(h, DEEP_COL, DEEP_FLOOR_ROW);
  await h.debug.setHull(POSED_HULL);
  await h.debug.setItemCount("matter-transmitter", 1);

  const home = await captureReplay(h, "home", async () => {
    const before = await h.snapshot();
    await h.debug.useItem("matter-transmitter");
    const placed = await h.snapshot();
    await h.advance(SETTLE_FRAMES);
    return { before, placed, settled: await h.snapshot() };
  });

  assertBetween(
    home.placed.miner.y + MINER_H,
    SURFACE_Y - EPSILON,
    SURFACE_Y + EPSILON,
    "the miner's feet on the camp ground line",
  );
  assertEqual(home.placed.miner.vx, 0, "sideways speed on arrival");
  assertEqual(home.placed.miner.vy, 0, "downward speed on arrival");
  assertEqual(
    home.placed.miner.hull,
    home.before.miner.hull,
    "hull across the transmission",
  );

  assertEqual(
    home.settled.miner.grounded,
    true,
    "grounded once it has settled",
  );
  assertEqual(
    home.settled.miner.hull,
    home.before.miner.hull,
    "hull once it has settled",
  );
});
