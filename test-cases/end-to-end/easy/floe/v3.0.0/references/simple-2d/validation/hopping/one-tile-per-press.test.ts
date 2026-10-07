// hopping/one-tile-per-press — one press and release moves the critter exactly
// one tile, however long the key stays down inside the cooldown.
//
// specs/hopping.md fixes two halves of one rule. "The critter moves in whole
// tiles, one tile per hop" — so an accepted hop is one tile and never two — and
// "A press released before the cooldown reaches `0` produces exactly one hop", so
// every tick the key stays down inside `HOP_COOLDOWN` after that hop is ignored.
// The tiles the critter did NOT move is the whole of what this point decides;
// which key it was and which way it went belong to `controls`.
//
// The key is held for the longest span that lies entirely inside the cooldown —
// one tick short of it — and then released, which is the hardest reading of the
// rule: a build that hops once per press passes, a build that hops on every tick
// the key is down reads as fourteen tiles, and a build that saves the press up and
// spends it when the cooldown runs out reads as two.
//
// It is driven SIDEWAYS along the near shore rather than up the strait
// (specs/strait.md: row `ROW_NEAR` is solid ice across the full width), so a build
// with a runaway cadence reads as a column a long way off rather than as a critter
// that hopped into the water, drowned, and respawned on the tile it started from.
// From `START_COL` there are nineteen columns of clear runway to the right edge.

import { afterEach, beforeEach, it } from "vitest";
import { ROW_NEAR, START_COL, tileCX, tileCY } from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdFor,
  HOP_COOLDOWN_TICKS,
  keyFor,
  startCrossing,
  type Harness,
} from "../harness";

/**
 * How long the key is held: one tick short of the cooldown.
 *
 * `HOP_COOLDOWN_TICKS` is the whole ticks covering `HOP_COOLDOWN` (specs/hopping.md),
 * so one fewer is the longest hold that ends while the cooldown is still running —
 * the span the item's "whatever the pressed key is held for afterwards within the
 * cooldown" names.
 */
const HOLD_TICKS = HOP_COOLDOWN_TICKS - 1;

/**
 * Frames watched after the release, with nothing held: four whole cooldowns.
 *
 * A build that latched the press and spends it when the cooldown runs out has four
 * chances to show it, and specs/hopping.md gives it none: a press released before
 * the cooldown reaches `0` is worth exactly one hop.
 */
const SETTLE_TICKS = 4 * HOP_COOLDOWN_TICKS;

/** The centre of a tile is exact (specs/hopping.md), so the tolerance is float noise. */
const CENTRE_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves exactly one tile for one press held inside the cooldown", async () => {
  startCrossing(h);
  const before = h.snapshot().critter;
  assertEqual(before.col, START_COL, "the column the crossing begins on");
  assertEqual(before.row, ROW_NEAR, "the row the crossing begins on");

  const after = await captureReplay(h, "hop", async () => {
    await holdFor(h, keyFor("right"), HOLD_TICKS);
    await h.advance(SETTLE_TICKS);
    return h.snapshot().critter;
  });

  assertEqual(after.col, START_COL + 1, "columns moved by one press");
  assertEqual(after.row, ROW_NEAR, "the row a sideways hop leaves alone");
  assertCloseTo(after.x, tileCX(START_COL + 1), CENTRE_DIGITS, "centre x");
  assertCloseTo(after.y, tileCY(ROW_NEAR), CENTRE_DIGITS, "centre y");
});
