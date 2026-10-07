// drilling/hit-interval — the drill lands hits at the stated interval.
//
// specs/character.md: the drill lands a hit every `DRILL_HIT_INTERVAL` (`0.125`)
// seconds, each hit removing the drill tier's damage from the target cell's
// health. So a cut of known length removes the number of hits that length
// allows, and the health left says how many landed.
//
// The cut is driven on a coreshell cell at drill tier 1, whose `BAND_HEALTH` is
// `16` against a damage of `1`: the longest cut the specification's tables
// allow, so the hold can run for twelve intervals without the cell breaking and
// the count read at the end is a twelfth-part reading of the rate rather than a
// quarter-part one.
//
// `specs/character.md` does not fix whether the first hit of a cut lands as the
// key goes down or one interval after it, and both are drills landing a hit
// every interval, so the reading allows exactly that one hit either way.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_HEALTH,
  DRILL_DAMAGE_TIERS,
  DRILL_HIT_INTERVAL,
} from "../constants";
import { assertBetween, assertEqual } from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  openScene,
  pinMiner,
  rowInBand,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** The band the cut is driven in: the deepest, and so the longest. */
const BAND = "coreshell";

/** The drill tier the cut runs at, and the damage one of its hits removes. */
const TIER = 1;
const DAMAGE = DRILL_DAMAGE_TIERS[TIER - 1];

/** Whole hit intervals the cut is held for: short of the sixteen that break it. */
const INTERVALS = 12;

/**
 * The hold, in frames of the harness's clock: half an interval past the twelfth.
 *
 * A hold that ended exactly on a hit boundary would be a reading of whether the
 * hit due at that instant had landed yet, which is arithmetic on the accumulated
 * frame deltas rather than anything `specs/character.md` fixes. Half an interval
 * clear of the boundary makes the count the rate alone.
 */
const HOLD_FRAMES = Math.round(
  (INTERVALS + 0.5) * DRILL_HIT_INTERVAL * TICK_HZ,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the hits the held span allows, at the stated interval", async () => {
  openScene(h);
  const { coreRow } = h.snapshot();
  const row = rowInBand(BAND, coreRow);
  h.debug.setTile(COL, row, "rock");
  standOn(h, COL, row);
  pinMiner(h);

  const opening = h.tileAt(COL, row);
  assertEqual(opening.health, BAND_HEALTH[BAND], "specs/world.md");

  const cut = await captureReplay(h, "hits", async () => {
    h.hold(ACTION_KEY.down);
    try {
      await h.advance(HOLD_FRAMES);
      return h.tileAt(COL, row);
    } finally {
      h.release(ACTION_KEY.down);
    }
  });

  // Still whole, so the count below is a count of hits landed rather than of a
  // cell that ran out of health part-way through the hold.
  assertEqual(cut.kind, "rock", "specs/character.md");
  const landed = (BAND_HEALTH[BAND] - (cut.health ?? 0)) / DAMAGE;
  assertBetween(landed, INTERVALS, INTERVALS + 1, "specs/character.md");
});
