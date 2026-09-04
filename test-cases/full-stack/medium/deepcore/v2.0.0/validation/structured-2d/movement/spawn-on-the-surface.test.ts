// movement/spawn-on-the-surface — an expedition starts standing on the camp.
//
// `specs/expedition.md`: "The miner starts standing on the camp ground at
// `SPAWN_COL` (`4`)", and `specs/world.md` puts the camp ground at `row 0`, whose
// floor is the top of `row 1` at `SURFACE_Y` (`80`). So a fresh expedition opens
// with the prospector on solid footing at the surface, at depth `0`, rather than
// already inside the mine or hanging in the air above it.
//
// WHY THE EXPEDITION IS OPENED THROUGH THE SURFACE RATHER THAN THE MENUS.
// `specs/instrumentation.md` has `reset` restore exactly the state an expedition
// opens in, "the miner standing on the camp ground at `SPAWN_COL` facing `east`
// at rest", and `generateMine` lay the mine "exactly as a started expedition's own
// generation does" while leaving the miner where it stands. That is the same
// starting position a player reaches through the title, reached without pressing a
// menu key — so a build with a broken title screen fails the navigation points and
// is still graded on where its prospector starts.
//
// AND IT DOES NOT SINK. The reading is taken after a full second of the game's own
// physics, because the failure this catches is not where the miner is placed but
// what happens on the first frames: a miner posed half a tile inside the camp
// ground, or on a camp with no ground under it, is at the surface for exactly as
// long as it takes gravity to notice.

import { afterEach, beforeEach, it } from "vitest";
import { METERS_PER_ROW, SPAWN_COL, SURFACE_Y, TILE } from "../constants";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  minerFeet,
  TICK_HZ,
  type Harness,
} from "../harness";

const SEEDS = [1, 2, 7] as const;

/** A second of the game's own physics, to catch a miner that sinks. */
const SETTLE_FRAMES = TICK_HZ;

/** The meters one world unit is worth, the slack a resting reading is taken to. */
const UNIT_METERS = METERS_PER_ROW / TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens every expedition on the camp ground at column 4, at depth 0", async () => {
  for (const seed of SEEDS) {
    const at = `the expedition on seed ${seed}`;
    h.debug.reset({ seed });
    h.debug.generateMine();
    h.debug.setScreen("in-mine");

    const opened = h.snapshot();
    await h.advance(SETTLE_FRAMES);
    const settled = h.snapshot();

    assertEqual(settled.miner.col, SPAWN_COL, `the spawn column of ${at}`);
    assertEqual(settled.miner.grounded, true, `the miner's footing in ${at}`);
    assertBetween(
      settled.depthMeters,
      0,
      UNIT_METERS,
      `the depth ${at} opens at`,
    );
    assertBetween(
      minerFeet(settled.miner),
      SURFACE_Y - 1,
      SURFACE_Y,
      `the miner's feet on the camp ground in ${at}`,
    );
    // And it did not sink over the second: the surface held it up.
    assertLessThanOrEqual(
      minerFeet(settled.miner),
      minerFeet(opened.miner) + 1,
      `the ground the miner held over a second of ${at}`,
    );
    assertCloseTo(settled.miner.vy, 0, 3, `the miner at rest in ${at}`);
  }

  // The picture: where a fresh expedition starts.
  await h.advance(1);
  captureStill(h, "start");
});
