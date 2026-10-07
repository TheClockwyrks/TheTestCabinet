// instrumentation/next-teleport-consumed-by-the-use — a teleport consumes the
// outcome posed for it.
//
// `specs/instrumentation.md`, Posing the Quantum Teleporter: "A posed value is
// consumed by the Quantum Teleporter use that places the miner with it, and reads
// `null` afterwards", and "a use with neither posed draws both as `specs/items.md`
// states": a height uniform from `1` to `8` tiles and a downward speed uniform
// from `150` to `700` units per second.
//
// SO TWO USES ARE MADE. The first is posed on both values and must leave both
// fields `null`; the second is made with nothing posed, so it draws, and its
// placement has to fall inside the stated ranges. A build that keeps the pose
// standing places the second use exactly where it placed the first, which the
// `null` read-back fails before the placement is even looked at.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertNull } from "../assert";
import {
  MINER_H,
  QUANTUM_DROP_MAX_TILES,
  QUANTUM_DROP_MIN_TILES,
  QUANTUM_VEL_MAX,
  QUANTUM_VEL_MIN,
  SURFACE_Y,
  TILE,
} from "../constants";
import {
  captureStill,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

/** The outcome posed for the first use. */
const POSED_TILES = 5;
const POSED_SPEED = 300;

/** The floor the miner is teleported away from, well underground. */
const DEEP_COL = 10;
const DEEP_FLOOR_ROW = 30;

/** Floating-point slack on a bound the specification states exactly. */
const EPSILON = 0.001;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes the posed outcome with the use, so the next use draws its own", async () => {
  await openScene(h);
  await layFloor(h, 1);
  await layFloor(h, DEEP_FLOOR_ROW);
  await pinDrill(h);
  await h.debug.setItemCount("quantum-teleporter", 2);

  await standOn(h, DEEP_COL, DEEP_FLOOR_ROW);
  await h.debug.setNextTeleportHeight(POSED_TILES);
  await h.debug.setNextTeleportSpeed(POSED_SPEED);
  await h.debug.useItem("quantum-teleporter");
  const consumed = await h.snapshot();
  assertNull(
    consumed.nextTeleportHeight,
    "nextTeleportHeight after the use that placed the miner with it",
  );
  assertNull(
    consumed.nextTeleportSpeed,
    "nextTeleportSpeed after the use that placed the miner with it",
  );

  // Nothing is posed now, so the next use draws inside the stated ranges.
  await standOn(h, DEEP_COL, DEEP_FLOOR_ROW);
  await h.debug.useItem("quantum-teleporter");
  const drawn = (await h.snapshot()).miner;
  await h.advance(1);
  await captureStill(h, "consumed");

  assertBetween(
    (SURFACE_Y - (drawn.y + MINER_H)) / TILE,
    QUANTUM_DROP_MIN_TILES - EPSILON,
    QUANTUM_DROP_MAX_TILES + EPSILON,
    "tiles above the camp ground on the drawn placement",
  );
  assertBetween(
    drawn.vy,
    QUANTUM_VEL_MIN - EPSILON,
    QUANTUM_VEL_MAX + EPSILON,
    "downward speed on the drawn placement",
  );
});
