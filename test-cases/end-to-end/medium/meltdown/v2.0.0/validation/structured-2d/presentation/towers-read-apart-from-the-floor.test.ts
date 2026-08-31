// presentation/towers-read-apart-from-the-floor — a tower is not the floor.
//
// THE RULE. specs/overview.md's legibility table: "A tower reads apart from the
// floor behind it." A tower's colour changes with its heat (the same table's
// first row), so a build could satisfy the rule at one end of the ramp and lose
// the floor at the other; the reading is therefore taken at the cold end, at the
// middle of the scale, and just under the trip, and every one of the eight towers
// specs/towers.md rosters is read, because every one of them is a tower.
//
// WHAT IS COMPARED, AND WHY IT IS NEVER A COLOUR. specs/overview.md fixes no
// palette, so what a tower looks like and what the floor looks like are both the
// build's. Every reading here is a comparison between two things the BUILD drew:
// the pixels of a footprint against the floor beside that footprint. The floor
// reference is LOCAL — the centre of a tile two tiles out on the same row — so a
// build free to shade its floor is measured against the floor it actually drew
// there rather than against a colour sampled from somewhere else.
//
// WHY A PROPORTION OF THE FOOTPRINT. A build draws things ON a tower that are
// not the tower: a type label, an outline, the heat read specs/hud.md asks for.
// Any of those may legitimately be drawn in a colour near the floor's — a label
// knocked out of the body, a bar with a dark trough. What the rule asks is that
// the TOWER read apart, so the reading is the proportion of the footprint that
// does, and the bar below says how much of it must.
//
// TWO CHECKS, NOT ONE. An emitter is read at three heats and a mover at one,
// because specs/heat.md gives the Forge and the Sink no heat to be read at: a
// build that draws its emitters apart from the floor and its movers into it
// grades differently from one that loses both.
//
// WHAT IT DOES NOT DECIDE. Whether the colour tracks the heat is
// `heat-glow-ramp`; whether a tripped tower reads apart from an online one is
// `tripped-reads-apart`; whether the tower sits where the tile map puts it is
// `floor.tile-map`. Nothing here asserts a shape, a label or an outline.

import { afterEach, beforeEach, it } from "vitest";
import { tileCX, tileCY } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type Harness,
  type TowerType,
} from "../harness";
import { poseStillTower } from "./pose";
import { isEmitter } from "./roster";
import { apartFraction, footprintRegion, pixelAt, readRegion } from "./read";

/**
 * How far, out of the 441 the RGB cube spans, a pixel of the footprint must sit
 * from the floor beside it to count as reading apart from it.
 *
 * The group's figure for two things a player tells apart at a glance, and the
 * same 50 every other point in this group draws its line at. It is comfortably
 * above the drift a build's own floor art carries across a couple of tiles — a
 * plate texture, lane shading, a grid line — so a tower cannot pass this by
 * standing on a patch of floor that happens to be shaded.
 */
const APART_MIN = 50;

/**
 * How much of a footprint must read apart from the floor.
 *
 * The rule is about the TOWER, and a tower reads as what most of it is drawn in.
 * Half is the line at which what a player sees on the footprint is more the
 * tower than the floor, and the half it leaves is room for everything a build
 * draws on a tower that is not the tower: a type label knocked through the body,
 * an outline, the heat read of specs/hud.md and its trough. A build that draws
 * its towers in the floor's own colour reads near zero, whatever it writes on
 * them.
 */
const FOOTPRINT_APART_MIN = 0.5;

/** The three heats an emitter is read at: cold, mid-scale, just under the trip. */
const HEATS: readonly number[] = [0, 50, 99];

/** The heat whose frame is kept as the point's picture. */
const SHOWN_HEAT = 50;

/**
 * Where each of the eight stands.
 *
 * Two rows of the floor, every footprint clear of the next, and every one clear
 * of the vent and exhaust runs specs/floor.md fixes. The floor each is read
 * against is the tile two columns to its left, which is open floor for all
 * eight.
 */
const ROSTER: readonly { type: TowerType; col: number; row: number }[] = [
  { type: "arc", col: 3, row: 4 },
  { type: "stutter", col: 8, row: 4 },
  { type: "rime", col: 13, row: 4 },
  { type: "flak", col: 18, row: 4 },
  { type: "forge", col: 33, row: 4 },
  { type: "sink", col: 38, row: 4 },
  { type: "bloom", col: 3, row: 24 },
  { type: "lance", col: 10, row: 24 },
];

/** How far the floor reference sits from the footprint, in tiles. */
const FLOOR_REFERENCE_TILES = 2;

/** How far inside the footprint the reading starts, and how dense it is. */
const FOOTPRINT_INSET = 3;
const FOOTPRINT_STEP = 3;

/** The whole roster posed at one heat, and each footprint read against the floor. */
async function readRoster(h: Harness, heat: number): Promise<number[]> {
  startRun(h);
  for (const { type, col, row } of ROSTER) {
    poseStillTower(h, type, col, row, 0, heat);
  }
  await h.advance(1);
  if (heat === SHOWN_HEAT) captureStill(h, "towers");

  return ROSTER.map(({ type, col, row }) => {
    const samples = readRegion(
      h,
      footprintRegion(col, row, sizeOf(type), FOOTPRINT_INSET),
      FOOTPRINT_STEP,
    );
    const floor = pixelAt(h, tileCX(col - FLOOR_REFERENCE_TILES), tileCY(row));
    return apartFraction(samples, floor, APART_MIN);
  });
}

/** The context a failure names: which tower, at what heat, and what was asked. */
function because(type: TowerType, heat: number): string {
  return (
    `a ${type} at heat ${heat}: the proportion of its footprint drawn at ` +
    `least ${APART_MIN} of 441 from the floor two tiles beside it ` +
    `(specs/overview.md: a tower reads apart from the floor behind it)`
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every emitter apart from the floor at every heat", async () => {
  for (const heat of HEATS) {
    const read = await readRoster(h, heat);
    ROSTER.forEach(({ type }, index) => {
      if (!isEmitter(type)) return;
      assertGreaterThanOrEqual(
        read[index],
        FOOTPRINT_APART_MIN,
        because(type, heat),
      );
    });
  }
});

it("draws the Forge and the Sink apart from the floor", async () => {
  // Both movers carry no heat and report `0` for it forever (specs/heat.md), so
  // one reading is every reading they have.
  const read = await readRoster(h, 0);
  ROSTER.forEach(({ type }, index) => {
    if (isEmitter(type)) return;
    assertGreaterThanOrEqual(
      read[index],
      FOOTPRINT_APART_MIN,
      because(type, 0),
    );
  });
});
