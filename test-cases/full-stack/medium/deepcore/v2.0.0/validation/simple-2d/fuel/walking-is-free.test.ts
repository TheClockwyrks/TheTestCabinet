// fuel/walking-is-free — walking and standing cost no fuel.
//
// specs/character.md: fuel is spent by thrusting, by drifting laterally in the
// air, by drilling, and by being underground, and "walking and standing still
// cost no fuel". So a walk along a carved corridor costs the underground
// life-support trickle and nothing more: lateral travel through tunnel is cheap
// where the same travel in the air pays `AIR_BURN`.
//
// The corridor is a posed floor with open ground above it, so the miner stays on
// the ground for the whole span and no side cut can start — there is nothing
// beside it to cut, and the drill is gated besides. The reading is the whole
// spend against `LIFE_SUPPORT_BURN` alone: a build billing `AIR_BURN` for a
// grounded walk would spend six times as much.

import { afterEach, beforeEach, it } from "vitest";
import { LIFE_SUPPORT_BURN } from "../constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 4;
const ROW = 12;

/** How long the walk is held, in seconds. */
const HOLD_SECONDS = 2;

/** The spend, and the two frames of it a build may bill either side of the walk. */
const EXPECTED = LIFE_SUPPORT_BURN * HOLD_SECONDS;
const TOLERANCE = (2 * LIFE_SUPPORT_BURN) / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends only life support while the miner walks a corridor", async () => {
  openScene(h);
  layFloor(h, ROW);
  standOn(h, COL, ROW, "east");
  pinDrill(h);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.miner.grounded, true, "specs/character.md");

  const after = await captureReplay(h, "walk", async () => {
    h.hold(ACTION_KEY.right);
    try {
      await h.advance(HOLD_SECONDS * TICK_HZ);
      return h.snapshot();
    } finally {
      h.release(ACTION_KEY.right);
    }
  });

  // It walked, and it stayed on the ground, so the spend is a walk's rather than
  // a drift's.
  assertGreaterThan(after.miner.x - before.miner.x, 0, "specs/character.md");
  assertEqual(after.miner.grounded, true, "specs/character.md");
  assertEqual(after.miner.state, "walk", "specs/character.md");

  assertBetween(
    before.miner.fuel - after.miner.fuel,
    EXPECTED - TOLERANCE,
    EXPECTED + TOLERANCE,
    "specs/character.md",
  );
});
