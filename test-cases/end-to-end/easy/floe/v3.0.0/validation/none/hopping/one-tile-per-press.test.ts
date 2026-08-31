// hopping/one-tile-per-press — a single press and release moves exactly one tile.
//
// `specs/hopping.md` fixes both halves of this. "The critter moves in whole
// tiles, one tile per hop", and a hop's target is the critter's tile "offset by
// one in the hopped direction"; and of the cadence, "a press released before the
// cooldown reaches `0` produces exactly one hop". So a key held for part of the
// cooldown and released inside it must leave the critter exactly one tile from
// where it started, and the cooldown must then run out with nothing further
// happening.
//
// The press is therefore held well inside the cooldown and then released, and
// the drive runs on past `HOP_COOLDOWN` with the key up: a build that hopped once
// per tick held, or that latched the press and spent it again when the cooldown
// expired, lands two tiles or more and is named here rather than by the cadence
// items next door.
//
// The hop is taken UP, from the middle of the ice band with the strait emptied,
// so both the tile it leaves and the tile it lands on are plain solid ice
// (`specs/strait.md`): no refusal rule can reach either, and nothing on the
// strait can move the critter but its own hop.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOP_COOLDOWN, HOP_KEY, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** A row of the ice band with clear ice above it, so neither tile is special. */
const ROW = 15;

/**
 * How long the key is held, in ticks: one tick short of the whole ticks
 * `HOP_COOLDOWN` (`0.12` s) covers.
 *
 * The longest hold that still ends INSIDE the cooldown the first hop set, which
 * is the widest reading of the "released before the cooldown reaches `0`"
 * clause and so the hardest case for a build that latches the press.
 */
const HOLD_TICKS = ticksFor(HOP_COOLDOWN) - 1;

/**
 * How long the drive runs on after the release: four whole cooldowns.
 *
 * The cooldown expires with the key up a quarter of the way into this, which is
 * the moment a build that had latched the press would spend it on a second
 * tile — and a build that spends it later, or that repeats on a cadence of its
 * own, has three further cooldowns to show it. One cooldown would see only the
 * first of those builds.
 */
const SETTLE_TICKS = ticksFor(4 * HOP_COOLDOWN);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("moves exactly one tile for a press held and released inside the cooldown", async () => {
  await startCrossing(harness);
  await harness.debug.addCritter(START_COL, ROW);

  // The tile the one hop is measured from, read from the build rather than
  // assumed of the pose.
  const before = await harness.snapshot();
  assertEqual(
    before.critter.col,
    START_COL,
    "the column the critter is posed on",
  );
  assertEqual(before.critter.row, ROW, "the row the critter is posed on");

  const after = await captureReplay(harness, "hop", async () => {
    await harness.hold(HOP_KEY.up);
    await harness.advance(HOLD_TICKS);
    await harness.release(HOP_KEY.up);
    await harness.advance(SETTLE_TICKS);
    return harness.snapshot();
  });

  assertEqual(after.critter.row, ROW - 1, "the row one hop up reaches");
  assertEqual(after.critter.col, START_COL, "the column, which no hop changed");
});
