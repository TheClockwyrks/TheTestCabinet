// building/place-builds-the-tower — placing a valid footprint puts the held tower
// on the floor.
//
// specs/building.md, Placing: on the frame a valid preview is committed, "a tower
// of the held type appears on the held footprint at the held rotation, at level 1,
// at heat 0, not tripped".
//
// THE WORLD IS POSED EMPTY and the footprint laid on a quiet anchor from
// `fixtures.ts`, so the placement is valid on all six of the specification's
// conditions and the only thing this reading is about is what the placement built.
//
// THE ROTATION HELD IS 1 RATHER THAN 0, so a build that placed at a rotation of
// its own reads a different number than the one it was handed rather than reading
// the default by luck. What the rotation does to the tower's world radiator faces
// is `building/placed-at-the-held-rotation`'s business.
//
// The type is the Stutter rather than the Arc so the type asserted is not the
// first entry in the shop order: a build that armed the wrong entry and placed its
// first one would pass with an Arc.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  towerById,
  type Harness,
} from "../harness";
import { placeAt, requirePlaced } from "./preview";

/** The type placed and the rotation it is held at. */
const HELD = "stutter";
const ROTATION = 1;

/** A quiet anchor: clear of every opening and of both corridors. */
const AT = FREE_SITE;

/** Enough money that affordability is never what refuses the placement. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("builds the held tower on the held footprint", async () => {
  await startRun(h);
  await h.debug.setMoney(PURSE);

  const placed = await placeAt(h, HELD, AT.col, AT.row, ROTATION);

  await h.advance(1);
  await captureStill(h, "placed");

  const id = requirePlaced(
    placed,
    `a ${HELD} on open floor at (${AT.col}, ${AT.row})`,
  );
  const tower = towerById(await h.snapshot(), id);
  assertEqual(tower?.type, HELD, "the placed tower's type");
  assertEqual(tower?.col, AT.col, "the placed tower's footprint column");
  assertEqual(tower?.row, AT.row, "the placed tower's footprint row");
  assertEqual(tower?.rotation, ROTATION, "the placed tower's rotation");
  assertEqual(tower?.level, 1, "the level a placed tower opens at");
  assertEqual(tower?.heat, 0, "the heat a placed tower opens at");
  assertEqual(tower?.tripped, false, "whether a placed tower opens tripped");
});
