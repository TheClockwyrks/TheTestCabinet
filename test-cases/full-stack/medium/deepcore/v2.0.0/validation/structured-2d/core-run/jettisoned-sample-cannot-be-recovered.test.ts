// Deepcore — core-run/jettisoned-sample-cannot-be-recovered: walking over a
// dropped Sample does nothing.
//
// `specs/items.md`: "A jettisoned Sample cannot be picked back up. Walking over
// it does nothing."
//
// A Sample is placed on a floored corridor and the miner is walked along it from
// one side of that cell to the other, with `right` held through the engine's own
// input so the game's own movement carries it. The walk is read as having really
// crossed the cell, and then three things are read back: nothing in the satchel,
// the Sample still on the cell it was placed on, and its timer still running.
//
// The drill is held off, because a key held to walk is a key that would cut into
// anything the miner came up against, and this check is about what the miner
// walked over rather than what it dug.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotNull,
} from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";
import { elapse } from "./core-scene";

/** The corridor the Sample lies in. */
const FLOOR_ROW = 11;
const SAMPLE_COL = 10;
const SAMPLE_ROW = FLOOR_ROW - 1;

/** Three tiles short of the Sample, so the walk really crosses its cell. */
const START_COL = SAMPLE_COL - 3;

/** Long enough at `WALK_SPEED` to carry the miner well past the cell. */
const WALK_SECONDS = 2.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a jettisoned Sample on its cell when the miner walks over it", async () => {
  openScene(h);
  layFloor(h, FLOOR_ROW);
  standOn(h, START_COL, FLOOR_ROW);
  pinDrill(h);
  h.debug.placeCoreSample(SAMPLE_COL, SAMPLE_ROW);

  const before = h.snapshot();
  assertLessThan(before.miner.col, SAMPLE_COL, "the column the walk starts at");

  const after = await captureReplay(h, "pass", async () => {
    h.hold(ACTION_KEY.right);
    try {
      await elapse(h, WALK_SECONDS);
    } finally {
      h.release(ACTION_KEY.right);
    }
    return h.snapshot();
  });

  assertGreaterThan(
    after.miner.col,
    SAMPLE_COL,
    "the column the walk ended past",
  );
  assertEqual(after.satchel.coreSample, false, "a Sample picked back up");
  assertDeepEqual(
    after.coreGround,
    { col: SAMPLE_COL, row: SAMPLE_ROW },
    "the cell the Sample is still on",
  );
  assertNotNull(after.coreTimer, "the dropped Sample's timer");
});
