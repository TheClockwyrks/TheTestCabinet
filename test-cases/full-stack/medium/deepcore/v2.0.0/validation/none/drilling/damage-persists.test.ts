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
import { assertBetween, assertEqual, assertLessThan } from "../assert";
import { BAND_HEALTH, DRILL_DAMAGE, DRILL_HIT_INTERVAL } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinMiner,
  standOn,
  TICK_HZ,
  rowInBand,
  type Harness,
} from "../harness";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** Where the miner waits while it is away from the cut. */
const AWAY_COL = COL + 6;

/** The band the cut is driven in: the deepest, and so the longest. */
const BAND = "coreshell";

/** The damage one hit removes at the tier the scene poses. */
const DAMAGE = DRILL_DAMAGE[0];

/** The first cut: five whole hit intervals, well short of the sixteen. */
const FIRST_FRAMES = Math.round(5 * DRILL_HIT_INTERVAL * TICK_HZ);

/** How long the miner spends away from the cell. */
const AWAY_FRAMES = TICK_HZ;

/** The second cut: one and a half intervals, so one or two hits land. */
const RESUME_FRAMES = Math.round(1.5 * DRILL_HIT_INTERVAL * TICK_HZ);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("resumes a partly cut cell from the health it kept", async () => {
  await openScene(h);
  const { coreRow } = await h.snapshot();
  const row = rowInBand(BAND, coreRow);
  await h.debug.setTile(COL, row, "rock");
  await h.debug.setTile(AWAY_COL, row, "rock");
  await standOn(h, COL, row);
  await pinMiner(h);

  const resumed = await captureReplay(h, "resume", async () => {
    await h.hold(ACTION_KEY.down);
    try {
      await h.advance(FIRST_FRAMES);
    } finally {
      await h.release(ACTION_KEY.down);
    }
    const cut = await h.tileAt(COL, row);

    // Away, on another cell, with nothing held.
    await h.debug.setMinerPosition(minerXOn(AWAY_COL), minerYOn(row));
    await h.advance(AWAY_FRAMES);
    const kept = await h.tileAt(COL, row);

    // And back, for one more interval of cutting.
    await h.debug.setMinerPosition(minerXOn(COL), minerYOn(row));
    await h.hold(ACTION_KEY.down);
    try {
      await h.advance(RESUME_FRAMES);
    } finally {
      await h.release(ACTION_KEY.down);
    }
    return { cut, kept, back: await h.tileAt(COL, row) };
  });

  const partial = resumed.cut.health ?? 0;
  assertLessThan(partial, BAND_HEALTH[BAND], "specs/character.md");
  assertBetween(partial, 1, BAND_HEALTH[BAND] - 1, "specs/character.md");

  // Kept, unchanged, while the miner was somewhere else entirely.
  assertEqual(resumed.kept.kind, "rock", "specs/character.md");
  assertEqual(resumed.kept.health, partial, "specs/character.md");

  // And resumed from there: one or two hits below it, rather than one or two
  // below a cell that had gone back to full.
  assertBetween(
    resumed.back.health ?? 0,
    partial - 2 * DAMAGE,
    partial - DAMAGE,
    "specs/character.md",
  );
});
