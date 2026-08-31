// hopping/one-tile-per-press — one press and release moves exactly one tile.
//
// specs/hopping.md fixes both halves of this. THE HOP: "The critter moves in
// whole tiles, one tile per hop, in one of the four grid directions", and an
// accepted hop "sets the critter's center to the target tile's center exactly".
// THE CADENCE: "A press released before the cooldown reaches `0` produces
// exactly one hop." So a direction held for less than `HOP_COOLDOWN` and then
// let go leaves the critter exactly one tile along — and it stays there, because
// with the key up nothing is being requested however long the game runs on.
//
// The critter stands where a fresh crossing puts it, on the near shore, and hops
// UP onto the ice band. `startCrossing` leaves the strait empty and the four
// world gates shut, so no vehicle, no bear and no expiring timer can move the
// critter or take it out of play: what decides where it ends up is the hop rule
// and nothing else. Both rows are solid ice across their whole width
// (specs/strait.md), so the hop is neither refused nor a hazard.

import { afterEach, beforeEach, it } from "vitest";
import { HOP_COOLDOWN, ROW_NEAR, START_COL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  critterTile,
  holdActionFor,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Frames the direction is held: one tick short of the whole ticks
 * `HOP_COOLDOWN` (`0.12` s) covers, so the key goes up at `0.108` s — strictly
 * inside the cooldown the first hop started, which is the case the rule names.
 */
const HELD_FRAMES = ticksFor(HOP_COOLDOWN) - 1;

/**
 * Frames watched with the key up: four cooldowns' worth. A build that repeats a
 * hop from a key that is no longer down has four chances to show it.
 */
const WATCHED_FRAMES = ticksFor(4 * HOP_COOLDOWN);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves exactly one tile for one press released inside the cooldown", async () => {
  startCrossing(h);
  const start = critterTile(h.snapshot());
  assertEqual(start.col, START_COL, "the column a fresh crossing starts on");
  assertEqual(start.row, ROW_NEAR, "the row a fresh crossing starts on");

  const after = await captureReplay(h, "hop", async () => {
    await holdActionFor(h, "up", HELD_FRAMES);
    await h.advance(WATCHED_FRAMES);
    return h.snapshot();
  });

  assertEqual(after.critter.row, start.row - 1, "the row after one press up");
  assertEqual(after.critter.col, start.col, "the column after one press up");
});
