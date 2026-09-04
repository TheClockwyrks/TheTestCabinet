// weight/drop-to-lift — dropping ore restores lift.
//
// specs/character.md: "the escape from an overload is dropping ore. The inventory
// is openable anywhere and discards one unit of a chosen ore at a time, so the
// player sheds weight until the load fraction falls below `1`." Below the wall
// the climb acceleration is `emptyAccel * max(0, 1 - load)` again, which is
// positive, so the next thrust climbs.
//
// The bay is posed well over the lift limit and units are discarded through the
// inventory's own drop control, one at a time, until the overload clears — the
// game's own rule decides when that is rather than a count computed here. Then
// thrust is held from the shaft floor, and the verdict is the height gained: a
// miner that could not lift before ends the hold above where it started.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { JETPACK_LIFT_LIMIT, ORES } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  digShaft,
  loadFraction,
  openScene,
  pinDrill,
  stageCargo,
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

/** The ore the bay is filled with, and the units posed: well over the limit. */
const ORE = "ferron";
const HELD = Math.ceil(
  (1.15 * JETPACK_LIFT_LIMIT[TIER - 1]) / ORES[ORE].weight,
);

/** How many drops the shedding may take before it counts as never clearing. */
const MAX_DROPS = HELD;

/** The climb, and the frames it is divided into. */
const HOLD_SECONDS = 2;
const FRAMES = 120;

/** How far the box must rise to count as having lifted off, in units. */
const LIFTED = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the overload as ore is shed, and climbs on the next thrust", async () => {
  await openScene(h);
  await stageTiers(h, { jetpack: TIER });
  await digShaft(h, COL, TOP_ROW, BOTTOM_ROW);
  await pinDrill(h);
  await stageCargo(h, { [ORE]: HELD });
  await standOn(h, COL, BOTTOM_ROW + 1);
  await h.advance(1);

  const before = await h.snapshot();
  assertGreaterThan(loadFraction(before), 1, "specs/character.md");
  assertEqual(before.miner.overloaded, true, "specs/character.md");
  assertEqual(before.miner.grounded, true, "specs/character.md");

  const shed = await captureReplay(h, "shed", async () => {
    let drops = 0;
    while (drops < MAX_DROPS && (await h.snapshot()).miner.overloaded) {
      await h.debug.dropOre(ORE);
      drops += 1;
      await h.advance(1);
    }
    const cleared = await h.snapshot();

    await h.hold(ACTION_KEY.up);
    try {
      await h.advanceSeconds(HOLD_SECONDS, FRAMES);
    } finally {
      await h.release(ACTION_KEY.up);
    }
    return { drops, cleared, climbed: await h.snapshot() };
  });

  // The overload cleared, and it cleared by shedding rather than by the bay
  // emptying itself.
  assertEqual(shed.cleared.miner.overloaded, false, "specs/character.md");
  assertLessThan(loadFraction(shed.cleared), 1, "specs/character.md");
  assertEqual(
    shed.cleared.cargo.ore[ORE],
    HELD - shed.drops,
    "specs/mining.md",
  );
  assertGreaterThan(shed.cleared.cargo.slotsUsed, 0, "specs/mining.md");

  // And the next thrust lifted it. Smaller `y` is higher.
  assertLessThan(
    shed.climbed.miner.y,
    before.miner.y - LIFTED,
    "specs/character.md",
  );
});
