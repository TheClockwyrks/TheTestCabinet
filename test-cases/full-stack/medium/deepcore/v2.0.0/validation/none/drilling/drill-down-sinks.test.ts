// drilling/drill-down-sinks — the miner sinks through the cell it cuts.
//
// specs/character.md: while down is held and the cell below is minable, the
// miner's feet travel from the top of that cell to its bottom in proportion to
// the cut's progress, `1 - health / BAND_HEALTH`, so the miner arrives flush on
// the next cell exactly as the cell it was cutting breaks.
//
// So the reading is the feet against the health, at every hit of one cut:
// `feet = row * TILE + TILE * (1 - health / BAND_HEALTH)`. The cell is a
// coreshell one at drill tier 1, which is sixteen hits — the finest the
// specification's tables allow, so one hit moves the miner a sixteenth of a tile
// and the depth reading is a sixteenth of a tile's worth of slack rather than a
// quarter of one. The cell BELOW the target is solid, so the miner is sinking
// through a cut rather than falling into a hollow, which is the sibling check.
//
// The tolerance is one hit's step, `TILE / hits`. `specs/character.md` states the
// depth as a function of the health the cell holds, and the health falls a hit at
// a time, so a build that carries the miner down smoothly between two hits and
// one that steps it down on each hit both satisfy the sentence and differ by
// exactly that step at a sample taken between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import { BAND_HEALTH, DRILL_DAMAGE, TILE, drillHitsFor } from "../constants";
import {
  ACTION_KEY,
  captureReplay,
  createHarness,
  minerFeet,
  openScene,
  rowInBand,
  standOn,
  type Harness,
} from "../harness";
import { SAMPLE_FRAMES } from "./hits";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** The band the cut is driven in: the deepest, and so the finest-grained. */
const BAND = "coreshell";

/** Hits to break a coreshell cell at drill tier 1: sixteen. */
const HITS = drillHitsFor(BAND_HEALTH[BAND], DRILL_DAMAGE[0]);

/** One hit's worth of the descent, which is the slack the reading allows. */
const STEP = TILE / HITS;

/** Frames the sweep may spend: the whole cut, and a hit interval of margin. */
const MAX_FRAMES = (HITS + 2) * SAMPLE_FRAMES * 3;

interface Sample {
  health: number;
  feet: number;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sinks the miner through the cell in proportion to the cut", async () => {
  await openScene(h);
  const { coreRow } = await h.snapshot();
  const row = rowInBand(BAND, coreRow);
  // The cell being cut, and a solid cell under it so the descent is a sink
  // rather than a fall into open space.
  await h.debug.setTile(COL, row, "rock");
  await h.debug.setTile(COL, row + 1, "rock");
  await standOn(h, COL, row);

  const start = await h.snapshot();
  assertEqual(minerFeet(start.miner), row * TILE, "specs/character.md");

  const cut = await captureReplay(h, "sink", async () => {
    const samples: Sample[] = [];
    await h.hold(ACTION_KEY.down);
    try {
      for (let frames = 0; frames < MAX_FRAMES; frames += SAMPLE_FRAMES) {
        await h.advance(SAMPLE_FRAMES);
        const tile = await h.tileAt(COL, row);
        const feet = minerFeet((await h.snapshot()).miner);
        if (tile.kind === "tunnel") return { samples, feet, broke: true };
        samples.push({ health: tile.health ?? 0, feet });
      }
      const feet = minerFeet((await h.snapshot()).miner);
      return { samples, feet, broke: false };
    } finally {
      await h.release(ACTION_KEY.down);
    }
  });

  assertEqual(cut.broke, true, "specs/character.md");
  // Several readings taken while the cut was still running, so the relation is
  // read across the descent rather than at its two ends alone.
  assertGreaterThan(cut.samples.length, HITS / 2, "specs/character.md");

  for (const sample of cut.samples) {
    const progress = 1 - sample.health / BAND_HEALTH[BAND];
    const expected = row * TILE + TILE * progress;
    assertBetween(
      sample.feet,
      expected - STEP,
      expected + STEP,
      "specs/character.md",
    );
  }

  // And it arrived flush on the next cell as the cell it was cutting broke.
  assertBetween(
    cut.feet,
    (row + 1) * TILE - STEP,
    (row + 1) * TILE + STEP,
    "specs/character.md",
  );
});
