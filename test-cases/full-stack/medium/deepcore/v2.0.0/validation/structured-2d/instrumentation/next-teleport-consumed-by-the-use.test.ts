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
  TELEPORT_HEIGHT_TILES_MAX,
  TELEPORT_HEIGHT_TILES_MIN,
  TELEPORT_SPEED_MAX,
  TELEPORT_SPEED_MIN,
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

afterEach(() => {
  h?.dispose();
});

it("consumes the posed outcome with the use, so the next use draws its own", async () => {
  openScene(h);
  layFloor(h, 1);
  layFloor(h, DEEP_FLOOR_ROW);
  pinDrill(h);
  h.debug.setItemCount("quantum-teleporter", 2);

  standOn(h, DEEP_COL, DEEP_FLOOR_ROW);
  h.debug.setNextTeleportHeight(POSED_TILES);
  h.debug.setNextTeleportSpeed(POSED_SPEED);
  h.debug.useItem("quantum-teleporter");
  const consumed = h.snapshot();
  assertNull(
    consumed.nextTeleportHeight,
    "nextTeleportHeight after the use that placed the miner with it",
  );
  assertNull(
    consumed.nextTeleportSpeed,
    "nextTeleportSpeed after the use that placed the miner with it",
  );

  // Nothing is posed now, so the next use draws inside the stated ranges.
  standOn(h, DEEP_COL, DEEP_FLOOR_ROW);
  h.debug.useItem("quantum-teleporter");
  const drawn = h.snapshot().miner;
  await h.advance(1);
  captureStill(h, "consumed");

  assertBetween(
    (SURFACE_Y - (drawn.y + MINER_H)) / TILE,
    TELEPORT_HEIGHT_TILES_MIN - EPSILON,
    TELEPORT_HEIGHT_TILES_MAX + EPSILON,
    "tiles above the camp ground on the drawn placement",
  );
  assertBetween(
    drawn.vy,
    TELEPORT_SPEED_MIN - EPSILON,
    TELEPORT_SPEED_MAX + EPSILON,
    "downward speed on the drawn placement",
  );
});
