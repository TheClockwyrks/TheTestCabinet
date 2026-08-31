// field/hud-strips-clear — play stays out of the two HUD strips.
//
// specs/field.md divides the stage into three full-width regions and puts play in
// the middle one: "The ship, the drones, and the bullets are drawn inside the play
// field. A drone crossing a HUD strip purely in transit is the one exception: a
// drone flying in from above the field, and a diving drone wrapping down through
// the bottom, cross a strip while they travel." So with a formation assembled and
// no drone in transit, nothing of the ship, the drones or the bullets appears
// inside `y` in `[0, HUD_TOP_H]` or `y` in `[HUD_BOTTOM_TOP, STAGE_H]`.
//
// HOW IT IS READ, AND WHY IT IS READ THAT WAY. The two strips are never empty —
// specs/field.md puts six readouts in them — so "nothing of play is drawn here"
// cannot be read as "no ink here". It is read as a CHANGE instead: the strips are
// photographed with the field empty, then the formation and two bullets in flight
// are posed and they are photographed again. Everything the strips carry is
// identical between the two frames, because nothing this scenario poses moves the
// score, the lives, the meter, the polarity or the mute bit, so a build that keeps
// play out of them changes nothing there and a build that draws a drone into one
// lights up a body's worth of samples.
//
// AND THE STRIPS' OWN DRIFT IS MEASURED RATHER THAN ASSUMED. A build is free to
// animate a readout, and one that does would move samples between any two frames
// whatever was posed. So the same reading is taken twice with the field still
// empty, one frame apart, and the allowance a posed field is judged against is
// that drift plus a fixed margin — one frame apart in both cases, so the two are
// comparable. Nothing here demands a still HUD.
//
// The entities are posed rather than played in, and every one of them is a prop:
// `poseFormation` leaves travel, oscillation and fire off, so nothing is in
// transit and the formation is exactly the assembled block the rule is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  FORM_COLS,
  FORM_ROWS,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  SHARD_SIZE,
  STAGE_H,
  STAGE_W,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseFormation,
  startPosed,
  type FormationEntry,
  type Harness,
  type Rect,
  type Rgb,
} from "../harness";
import { countMoved, readLattice } from "./canvas";

/**
 * How far a sample must move between two readings, on the 0–441 RGB scale, to
 * count as having changed.
 *
 * The same twentieth-of-the-scale bar the rest of this group uses for "something
 * was painted here": well under anything the legibility table's "told apart from
 * the field behind it" could measure, and well over the rounding a canvas round
 * trip leaves.
 */
const MOVED_MIN = 25;

/** How finely each strip is read, in logical units. */
const STRIP_STEP = 2;

/**
 * How many changed samples a posed field may add to a strip beyond the strip's
 * own frame-to-frame drift.
 *
 * The smallest body the rule names is a Shard, `SHARD_SIZE` (28) units across, so
 * on a STRIP_STEP (2) lattice the smallest thing that could be wrongly drawn into
 * a strip covers 14 x 14 = 196 samples. 24 is an eighth of that: room for the odd
 * anti-aliased sample a re-render moves, none for a body — and a Shard drawn only
 * half inside a strip still lights four times the allowance.
 */
const DRIFT_ALLOWANCE = Math.floor((SHARD_SIZE / STRIP_STEP) ** 2 / 8);

/** Where the two bullets are put: mid-field, clear of both strips and the grid. */
const PLAYER_SHOT = { x: 360, y: 460 } as const;
const ENEMY_SHOT = { x: 920, y: 460 } as const;

/** The two HUD strips, as specs/field.md's table of regions gives them. */
const STRIPS: readonly { where: string; rect: Rect }[] = [
  {
    where: "the top HUD strip",
    rect: { x: 0, y: 0, width: STAGE_W, height: HUD_TOP_H },
  },
  {
    where: "the bottom HUD strip",
    rect: {
      x: 0,
      y: HUD_BOTTOM_TOP,
      width: STAGE_W,
      height: STAGE_H - HUD_BOTTOM_TOP,
    },
  },
];

/**
 * The formation posed: the whole grid, one drone per slot.
 *
 * The block that reaches closest to both strips — its top row at `FORM_ROW0_Y`
 * (140) and its bottom row at 332 — and the widest one a wave can hold, so a
 * build that drew the formation into a strip has every chance to.
 */
function wholeGrid(): FormationEntry[] {
  const entries: FormationEntry[] = [];
  for (let row = 0; row < FORM_ROWS; row += 1) {
    for (let col = 0; col < FORM_COLS; col += 1) {
      entries.push({
        kind: col % 3 === 0 ? "flux" : col % 3 === 1 ? "shard" : "prism",
        col,
        row,
      });
    }
  }
  return entries;
}

/** Both strips, photographed on the same lattice, in the order of {@link STRIPS}. */
async function readStrips(h: Harness): Promise<Rgb[][]> {
  const readings: Rgb[][] = [];
  for (const strip of STRIPS) {
    readings.push(await readLattice(h, strip.rect, STRIP_STEP));
  }
  return readings;
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws nothing of the ship, the drones or the bullets into either HUD strip", async () => {
  await startPosed(harness);
  await harness.advance(1);

  // Two readings of the empty field, one frame apart: what the strips do on their
  // own, whether or not this build animates a readout.
  const first = await readStrips(harness);
  await harness.advance(1);
  const second = await readStrips(harness);

  // The assembled block, and one bullet of each side in flight over the field.
  await poseFormation(harness, wholeGrid());
  await harness.debug.addPlayerBullet(PLAYER_SHOT.x, PLAYER_SHOT.y, "cyan");
  await harness.debug.addEnemyBullet(ENEMY_SHOT.x, ENEMY_SHOT.y, "magenta");
  await harness.advance(1);
  const posed = await readStrips(harness);
  await captureStill(harness, "strips");

  for (const [index, strip] of STRIPS.entries()) {
    const drift = countMoved(first[index], second[index], MOVED_MIN);
    const changed = countMoved(second[index], posed[index], MOVED_MIN);
    assertLessThanOrEqual(
      changed,
      drift + DRIFT_ALLOWANCE,
      `samples ${strip.where} changed when the field was posed, over its own ` +
        `frame-to-frame drift of ${drift} (specs/field.md)`,
    );
  }
});
