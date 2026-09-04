// fuel/air-burn — drifting laterally in the air costs fuel.
//
// specs/character.md: fuel is spent by thrusting, by drifting laterally in the
// air, by drilling, and by being underground. Lateral drift in the air is
// `AIR_BURN` (`2`) fuel per second, so steering a fall is not free.
//
// The miner is dropped in the open sky with a lateral direction held and nothing
// else: `specs/character.md` moves the miner horizontally at `WALK_SPEED` in the
// air as well as on the ground, so the drift is real rather than posed. Above the
// ground line there is no life support on the meter, and falling itself is free,
// so the fuel spent over the span is the air burn alone. The drill is held, since
// nothing here is about cutting — and there is nothing in the sky to cut.

import { afterEach, beforeEach, it } from "vitest";
import { AIR_BURN, SURFACE_Y } from "../../src/constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerFeet,
  openScene,
  pinDrill,
  TICK_HZ,
  type Harness,
} from "../harness";
import { SKY_Y, standInSky } from "./sky";

/** A column with room to drift east without leaving the grid. */
const COL = 8;

/** How long the direction is held, in seconds. */
const HOLD_SECONDS = 1;

/** The spend, and the two frames of it a build may bill either side of the hold. */
const EXPECTED = AIR_BURN * HOLD_SECONDS;
const TOLERANCE = (2 * AIR_BURN) / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spends AIR_BURN a second while drifting laterally in the air", async () => {
  openScene(h);
  standInSky(h, COL);
  pinDrill(h);

  const before = h.snapshot();
  assertEqual(before.miner.grounded, false, "specs/character.md");

  const after = await captureReplay(h, "drift", async () => {
    h.hold(ACTION_KEY.right);
    try {
      await h.advance(HOLD_SECONDS * TICK_HZ);
      return h.snapshot();
    } finally {
      h.release(ACTION_KEY.right);
    }
  });

  // It really drifted, and it was airborne above the ground line throughout, so
  // the spend below is the air burn rather than a life-support trickle.
  assertGreaterThan(after.miner.x - before.miner.x, 0, "specs/character.md");
  assertEqual(after.miner.grounded, false, "specs/character.md");
  assertBetween(minerFeet(after.miner), SKY_Y, SURFACE_Y, "specs/character.md");

  assertBetween(
    before.miner.fuel - after.miner.fuel,
    EXPECTED - TOLERANCE,
    EXPECTED + TOLERANCE,
    "specs/character.md",
  );
});
