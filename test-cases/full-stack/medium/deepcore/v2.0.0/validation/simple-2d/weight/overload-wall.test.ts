// weight/overload-wall — an overloaded miner cannot climb.
//
// specs/character.md: at a load of `1` or more the climb acceleration is `0` —
// `climbAccel = emptyAccel * max(0, 1 - load)` — so holding thrust arrests the
// fall's acceleration and produces no climb, and the miner cannot lift off. That
// is the overload wall, and the escape from it is dropping ore, which is the
// sibling check.
//
// The scene is a cleared shaft with the miner standing on its floor, so the
// height it starts at is a resting height rather than a posed one and any lift at
// all would show as the box leaving that floor. Three seconds of thrust is more
// than four times what an empty miner at this tier needs to reach its climb cap.
// The verdict is the height reached: at or below where it started.

import { afterEach, beforeEach, it } from "vitest";
import { JETPACK_TIERS } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  digShaft,
  loadFraction,
  loadToFraction,
  openScene,
  pinDrill,
  stageTiers,
  standOn,
  type Harness,
} from "../harness";

/** The shaft: a column, and the rows it is open through. */
const COL = 8;
const TOP_ROW = 4;
const BOTTOM_ROW = 20;

/** The jetpack tier the climb is attempted at. */
const TIER = 1;

/** The climb, and the frames it is divided into. */
const HOLD_SECONDS = 3;
const FRAMES = 90;

/** How far the box may rise and still count as not having lifted, in units. */
const STILL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lifts an overloaded miner nowhere however long thrust is held", async () => {
  openScene(h);
  stageTiers(h, { jetpack: TIER });
  digShaft(h, COL, TOP_ROW, BOTTOM_ROW);
  pinDrill(h);
  loadToFraction(h, 1);
  standOn(h, COL, BOTTOM_ROW + 1);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(
    before.cargo.liftLimitKg,
    JETPACK_TIERS[TIER - 1].liftLimitKg,
    "specs/upgrades.md",
  );
  assertGreaterThanOrEqual(loadFraction(before), 1, "specs/character.md");
  assertEqual(before.miner.overloaded, true, "specs/character.md");
  assertEqual(before.miner.grounded, true, "specs/character.md");

  const after = await captureReplay(h, "overload", async () => {
    h.hold(ACTION_KEY.up);
    try {
      await h.advanceSeconds(HOLD_SECONDS, FRAMES);
      return h.snapshot();
    } finally {
      h.release(ACTION_KEY.up);
    }
  });

  // Smaller `y` is higher, so a climb would read below where it started.
  assertGreaterThanOrEqual(
    after.miner.y,
    before.miner.y - STILL,
    "specs/character.md",
  );
});
