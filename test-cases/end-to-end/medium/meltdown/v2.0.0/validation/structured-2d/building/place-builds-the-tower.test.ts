// building/place-builds-the-tower — placing a valid footprint puts the held
// tower on the floor.
//
// specs/building.md, Placing: on the frame a valid preview is committed, "a tower
// of the held type appears on the held footprint at the held rotation, at level
// 1, at heat 0, not tripped".
//
// The world is posed empty and the footprint laid on open floor clear of the four
// openings, so the placement is valid on all six of the specification's
// conditions and the only thing the reading is about is what the placement built.
// The rotation held is 1 rather than 0, so a build that placed at a rotation of
// its own reads a different number than the one it was handed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  placeAt,
  startRun,
  towerById,
  type Harness,
} from "../harness";

/** The type placed, the footprint it is placed on, and the rotation held. */
const HELD = "arc";
const COL = 10;
const ROW = 8;
const ROTATION = 1;

/** Enough money that affordability is never what refuses the placement. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds the held tower on the held footprint", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);

  const id = placeAt(h, HELD, COL, ROW, ROTATION);

  await h.advance(1);
  captureStill(h, "placed");

  assertNotNull(id, "the tower a valid placement built");
  const tower = towerById(h.snapshot(), id as number);
  assertEqual(tower?.type, HELD, "the placed tower's type");
  assertEqual(tower?.col, COL, "the placed tower's footprint column");
  assertEqual(tower?.row, ROW, "the placed tower's footprint row");
  assertEqual(tower?.rotation, ROTATION, "the placed tower's rotation");
  assertEqual(tower?.level, 1, "the level a placed tower opens at");
  assertEqual(tower?.heat, 0, "the heat a placed tower opens at");
  assertEqual(tower?.tripped, false, "whether a placed tower opens tripped");
});
