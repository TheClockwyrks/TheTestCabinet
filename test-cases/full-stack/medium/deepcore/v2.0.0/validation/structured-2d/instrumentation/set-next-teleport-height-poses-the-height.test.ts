// instrumentation/set-next-teleport-height-poses-the-height — the posed height is
// the height the next teleport places the miner at.
//
// `specs/instrumentation.md`, Posing the Quantum Teleporter:
// `setNextTeleportHeight(tiles)` sets "The height above the camp ground, in
// tiles, the next Quantum Teleporter use places the miner at, from `1` to `8` as
// `specs/items.md` bounds the draw, or `null` to leave the height to the draw",
// and the snapshot reports it as `nextTeleportHeight`, "`null` while no outcome
// is posed".
//
// THE READ-BACK COMES FIRST. A pose is verified by setting a value and reading it
// back, so the height is posed, read, cleared with `null` and read again before
// the teleporter is used at all. Then the height is posed once more and the item
// is used from deep underground, and the placement is read on the call itself,
// before any frame runs, so what is measured is where the item put the miner
// rather than where gravity had taken it by the time it was looked at.
//
// THE HEIGHT IS THE MINER'S FEET ABOVE `SURFACE_Y`, the world `y` `specs/world.md`
// gives the camp's ground line, in tiles. It is compared to a tolerance a float
// could differ by, because the build's arithmetic is its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertNull } from "../assert";
import { MINER_H, SURFACE_Y, TILE } from "../constants";
import {
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** The height posed for the read-back, and the one the teleport is used with. */
const READ_BACK_TILES = 6;
const POSED_TILES = 3;

/** The floor the miner is teleported away from, well underground. */
const DEEP_COL = 10;
const DEEP_FLOOR_ROW = 30;

/** Frames the placed miner is left falling for, so the recording shows it. */
const SHOWN_FRAMES = 30;

/** Decimal places the placement is held to. */
const PLACES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses the height the next Quantum Teleporter use places the miner at", async () => {
  openScene(h);
  layFloor(h, 1);
  layFloor(h, DEEP_FLOOR_ROW);
  pinDrill(h);
  h.debug.setItemCount("quantum-teleporter", 1);
  standOn(h, DEEP_COL, DEEP_FLOOR_ROW);

  // Set, read back, clear, read back.
  h.debug.setNextTeleportHeight(READ_BACK_TILES);
  assertEqual(
    h.snapshot().nextTeleportHeight,
    READ_BACK_TILES,
    "nextTeleportHeight after a pose",
  );
  h.debug.setNextTeleportHeight(null);
  assertNull(
    h.snapshot().nextTeleportHeight,
    "nextTeleportHeight after setNextTeleportHeight(null)",
  );

  // Pose it again and use the teleporter: the placement is the posed height.
  h.debug.setNextTeleportHeight(POSED_TILES);
  const placed = await captureReplay(h, "posed-height", async () => {
    h.debug.useItem("quantum-teleporter");
    const { miner } = h.snapshot();
    await h.advance(SHOWN_FRAMES);
    return miner;
  });

  assertCloseTo(
    (SURFACE_Y - (placed.y + MINER_H)) / TILE,
    POSED_TILES,
    PLACES,
    "tiles above the camp ground the teleport placed the miner at",
  );
});
