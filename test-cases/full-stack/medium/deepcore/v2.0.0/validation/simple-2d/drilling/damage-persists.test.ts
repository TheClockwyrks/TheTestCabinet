// drilling/damage-persists — a partly cut cell keeps its damage.
//
// specs/character.md: a cell partly cut keeps its remaining health when the
// miner moves away, and the fuel already spent is not refunded. Returning to it
// resumes from the health it holds.
//
// The cut runs on a coreshell cell at drill tier 1, sixteen hits deep, so there
// is room to leave it well short of breaking and still read the resumption. The
// miner's body is held still, so leaving and returning are two poses rather than
// a walk that would sink the miner into the cell it is cutting on the way.
//
// Three readings, in order: the cell is partly cut; it still holds exactly that
// health after the miner has been elsewhere for a second; and one more interval
// of cutting takes it down from THAT health rather than from a full cell.

import { afterEach, beforeEach, it } from "vitest";
import {
  BAND_HEALTH,
  DRILL_DAMAGE_TIERS,
  DRILL_HIT_INTERVAL,
} from "../constants";
import {
  assertBetween,
  assertEqual,
  assertLessThan,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinMiner,
  rowInBand,
  standOn,
  TICK_HZ,
  type Harness,
} from "../harness";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** Where the miner waits while it is away from the cut. */
const AWAY_COL = COL + 6;

/** The band the cut is driven in: the deepest, and so the longest. */
const BAND = "coreshell";

/** The damage one hit removes at the tier the scene poses. */
const DAMAGE = DRILL_DAMAGE_TIERS[0];

/** The first cut: five whole hit intervals, well short of the sixteen. */
const FIRST_FRAMES = Math.round(5 * DRILL_HIT_INTERVAL * TICK_HZ);

/** How long the miner spends away from the cell. */
const AWAY_FRAMES = TICK_HZ;

/**
 * Frames the resumed cut may spend waiting for its next hit.
 *
 * The resumed cut is swept to the NEXT fall in health rather than held for a
 * fixed span, because what this point is about is the health that fall starts
 * from. A fixed span would be a span measured in the specification's hit
 * interval, and would fail a build whose drill was merely slow.
 */
const RESUME_FRAMES = Math.round(8 * DRILL_HIT_INTERVAL * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes a partly cut cell from the health it kept", async () => {
  openScene(h);
  const { coreRow } = h.snapshot();
  const row = rowInBand(BAND, coreRow);
  h.debug.setTile(COL, row, "rock");
  h.debug.setTile(AWAY_COL, row, "rock");
  standOn(h, COL, row);
  pinMiner(h);

  const resumed = await captureReplay(h, "resume", async () => {
    h.hold(ACTION_KEY.down);
    try {
      await h.advance(FIRST_FRAMES);
    } finally {
      h.release(ACTION_KEY.down);
    }
    const cut = h.tileAt(COL, row);

    // Away, on another cell, with nothing held.
    h.debug.setMinerPosition(minerXOn(AWAY_COL), minerYOn(row));
    await h.advance(AWAY_FRAMES);
    const kept = h.tileAt(COL, row);

    // And back, cutting until the next hit lands.
    h.debug.setMinerPosition(minerXOn(COL), minerYOn(row));
    const from = kept.health ?? 0;
    let back = kept;
    let first: typeof kept | null = null;
    h.hold(ACTION_KEY.down);
    try {
      for (let frame = 0; frame < RESUME_FRAMES; frame += 1) {
        await h.advance(1);
        back = h.tileAt(COL, row);
        first ??= back;
        if (back.kind === "tunnel" || (back.health ?? 0) < from) break;
      }
    } finally {
      h.release(ACTION_KEY.down);
    }
    return { cut, kept, back, first };
  });

  const partial = resumed.cut.health ?? 0;
  assertLessThan(partial, BAND_HEALTH[BAND], "specs/character.md");
  assertBetween(partial, 1, BAND_HEALTH[BAND] - 1, "specs/character.md");

  // Kept, unchanged, while the miner was somewhere else entirely.
  assertEqual(resumed.kept.kind, "rock", "specs/character.md");
  assertEqual(resumed.kept.health, partial, "specs/character.md");

  // And resumed from there: the next hit took it one damage below the health it
  // kept, rather than one below a cell that had gone back to full.
  assertEqual(resumed.back.kind, "rock", "specs/character.md");
  // The resumed cut starts from the health the cell kept, so its FIRST sample is
  // already at or below that. Without this, a build that reset the cell to full on
  // restarting the cut still walks down through `partial - DAMAGE` and satisfies the
  // check below, which is the one behaviour specs/character.md forbids.
  assertNotNull(resumed.first, "specs/character.md");
  assertLessThanOrEqual(
    resumed.first?.health ?? 0,
    partial,
    "specs/character.md",
  );
  assertEqual(resumed.back.health, partial - DAMAGE, "specs/character.md");
});
