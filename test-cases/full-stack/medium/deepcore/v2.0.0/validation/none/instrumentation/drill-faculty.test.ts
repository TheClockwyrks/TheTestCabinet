// instrumentation/drill-faculty — with the drill off no cut starts or progresses.
//
// `specs/instrumentation.md`: "With the drill off, no cut starts and none
// progresses, so no cell loses health, no cell breaks, nothing is banked, and no
// drill hit spends fuel. Everything else carries on: the miner walks, falls,
// thrusts, and takes damage exactly as it does with the drill running."
//
// It is the companion of the travel gate, and it is what lets a check about
// movement, the camera, or a landing hold a direction key without quietly boring
// a hole through the scene it was posed in. A build that gates the drill by
// gating the miner, or that stops the cut but keeps spending its fuel, breaks
// every one of those checks in a way none of them can see.
//
// SO BOTH HALVES ARE READ. First the inertness: the miner is stood on an ORE
// vein, whose cell would bank a unit into the bay the moment it broke, and the
// down key is held for half a second — four hits' worth at
// `DRILL_HIT_INTERVAL` — and the cell, the bay and the fuel are read afterwards.
// The fuel is the sharpest of the three: with no hit landing, the only drain a
// grounded miner below the ground line has is life support at
// `LIFE_SUPPORT_BURN` per second, so the half second costs exactly `0.2` and a
// build still charging for hits it did not land reads a full unit higher.
//
// Then the carrying on, in the three ways the sentence names: the miner walks
// along the floor, falls when it is let go over open ground and takes the hull
// damage `specs/hazards.md` prices that landing at, and thrusts back up — all
// with the drill still gated.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import {
  BAND_HEALTH,
  IMPACT_SAFE_SPEED,
  LIFE_SUPPORT_BURN,
  TILE,
} from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  driveFall,
  driveHold,
  layFloor,
  layOre,
  openScene,
  pinDrill,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

const COL = 8;
const ROW = 12;
/** A column clear of the ore vein, for the fall and the climb. */
const FALL_COL = 14;

/** Half a second held on the ore, which is four hits at the drill's interval. */
const HELD_FRAMES = TICK_HZ / 2;
const HELD_SECONDS = HELD_FRAMES / TICK_HZ;

/** The moves that carry on with the drill gated. */
const WALK_FRAMES = TICK_HZ / 2;
const CLIMB_FRAMES = TICK_HZ / 2;
/** Far enough that the landing is over `IMPACT_SAFE_SPEED` and costs hull. */
const DROP_HEIGHT = 20 * TILE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("cuts nothing, banks nothing and spends no drill fuel, while the miner still moves", async () => {
  await openScene(h);
  await layFloor(h, ROW);
  await layOre(h, COL, ROW, "ferron");
  await standOn(h, COL, ROW);
  await pinDrill(h);

  const before = (await h.snapshot()).miner.fuel;
  const inert = await captureReplay(h, "inert", async () => {
    await h.hold(ACTION_KEY.down);
    await h.advance(HELD_FRAMES);
    await h.releaseAll();
    return { snapshot: await h.snapshot(), tile: await h.tileAt(COL, ROW) };
  });

  // The cell is whole, and it is still the vein it was.
  assertEqual(
    inert.tile.kind,
    "ore",
    "the cell the gated drill was held against",
  );
  assertEqual(inert.tile.ore, "ferron", "the ore that cell still holds");
  assertEqual(
    inert.tile.health,
    BAND_HEALTH.topsoil,
    "the health of the cell the gated drill was held against",
  );
  // Nothing was banked: no cell broke, so no unit reached the bay.
  assertEqual(inert.snapshot.cargo.slotsUsed, 0, "the slots used");
  assertEqual(inert.snapshot.cargo.ore.ferron ?? 0, 0, "the ferron banked");
  // And no hit was paid for: only life support ran.
  assertCloseTo(
    before - inert.snapshot.miner.fuel,
    LIFE_SUPPORT_BURN * HELD_SECONDS,
    3,
    "the fuel half a second of a gated drill cost",
  );
  assertEqual(inert.snapshot.miner.drill, false, "the drill faculty");

  // Everything else carries on. It walks ...
  const walk = await driveHold(h, ACTION_KEY.right, WALK_FRAMES, {
    leadFrames: 20,
  });
  assertGreaterThan(walk.dx, 0, "the ground the gated miner walked");

  // ... it falls, and takes the hull the landing costs ...
  const hullBefore = (await h.snapshot()).miner.hull;
  const fall = await driveFall(h, FALL_COL, ROW, DROP_HEIGHT, {
    maxFrames: 400,
  });
  assertEqual(fall.landed, true, "the gated miner's fall reaching the floor");
  assertGreaterThan(
    fall.impactSpeed,
    IMPACT_SAFE_SPEED,
    "the speed the gated miner landed at",
  );
  assertLessThan(
    fall.snapshot.miner.hull,
    hullBefore,
    "the hull the gated miner's landing cost",
  );

  // ... and it thrusts.
  const climb = await driveHold(h, ACTION_KEY.up, CLIMB_FRAMES);
  assertLessThan(climb.dy, 0, "the height the gated miner's thrust gained");
});
