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
// lights up a body's worth of pixels.
//
// AND THE STRIPS' OWN DRIFT IS MEASURED RATHER THAN ASSUMED. A build is free to
// animate a readout, and one that does would move pixels between any two frames
// whatever was posed. So the same reading is taken twice with the field still
// empty, one frame apart, and the allowance a posed field is judged against is
// that drift plus a fixed margin — one frame apart in both cases, so the two are
// comparable. Nothing here demands a still HUD.
//
// The entities are posed rather than played in, and every one of them is a prop:
// `poseFormation` leaves travel, oscillation and fire off, so nothing is in transit
// and the formation is exactly the assembled block the rule is about, standing
// still where it was put.
//
// WHAT THIS DOES NOT DECIDE. That the strips are on the canvas at all, which is
// the sibling `field/stage-fit`, and what they say, which is `screens/hud-*`.

import { afterEach, beforeEach, it } from "vitest";
import { FORM_COLS, FORM_ROWS, SHARD_SIZE } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseFormation,
  readRegion,
  startPosed,
  type FormationEntry,
  type Harness,
  type Region,
} from "../harness";
import { HUD_STRIPS, countMoved } from "./canvas";

/**
 * How far a pixel must move between two readings, on the 0–441 RGB scale, to count
 * as having changed.
 *
 * The same twentieth-of-the-scale bar `field/stage-fit` uses for "something was
 * painted here": well under anything the legibility table's "told apart from the
 * field behind it" could measure, and well over the rounding a canvas round trip
 * leaves.
 */
const MOVED_MIN = 25;

/**
 * How many changed pixels a posed field may add to a strip beyond the strip's own
 * frame-to-frame drift.
 *
 * The smallest body the rule names is a Shard, `SHARD_SIZE` (28) units across, and
 * this check reads at the stage's own size, where one logical unit is one device
 * pixel, so the smallest thing that could be wrongly drawn into a strip covers
 * `28 x 28` = 784 pixels. An eighth of that is room for the odd anti-aliased pixel
 * a re-render moves and none for a body: a Shard drawn only a quarter inside a
 * strip still lights nearly twice the allowance.
 */
const DRIFT_ALLOWANCE = Math.floor(SHARD_SIZE ** 2 / 8);

/** Where the two bullets are put: mid-field, clear of both strips and the grid. */
const PLAYER_SHOT = { x: 360, y: 460 } as const;
const ENEMY_SHOT = { x: 920, y: 460 } as const;

/**
 * The formation posed: the whole grid, one drone per slot.
 *
 * The block that reaches closest to both strips — its top row at `FORM_ROW0_Y`
 * (140) and its bottom row at 332 — and the widest one a wave can hold, so a build
 * that drew the formation into a strip has every chance to. All three kinds are
 * spread across it, so a build that drew only one of them wrongly is still caught.
 */
function wholeGrid(): FormationEntry[] {
  const entries: FormationEntry[] = [];
  for (let row = 0; row < FORM_ROWS; row += 1) {
    for (let col = 0; col < FORM_COLS; col += 1) {
      const kind = col % 3 === 0 ? "flux" : col % 3 === 1 ? "shard" : "prism";
      entries.push({ kind, col, row });
    }
  }
  return entries;
}

/** Both strips, read in the order {@link HUD_STRIPS} gives them. */
function readStrips(h: Harness): Region[] {
  return HUD_STRIPS.map((strip) => readRegion(h, strip.box));
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws nothing of the ship, the drones or the bullets into either HUD strip", async () => {
  startPosed(harness);
  await harness.advance(1);

  // Two readings of the empty field, one frame apart: what the strips do on their
  // own, whether or not this build animates a readout.
  const first = readStrips(harness);
  await harness.advance(1);
  const second = readStrips(harness);

  // The assembled block, and one bullet of each side in flight over the field.
  poseFormation(harness, wholeGrid());
  harness.debug.addPlayerBullet(PLAYER_SHOT.x, PLAYER_SHOT.y, "cyan");
  harness.debug.addEnemyBullet(ENEMY_SHOT.x, ENEMY_SHOT.y, "magenta");
  await harness.advance(1);
  const posed = readStrips(harness);
  captureStill(harness, "strips");

  for (const [index, strip] of HUD_STRIPS.entries()) {
    const drift = countMoved(first[index], second[index], MOVED_MIN);
    const changed = countMoved(second[index], posed[index], MOVED_MIN);
    assertLessThanOrEqual(
      changed,
      drift + DRIFT_ALLOWANCE,
      `pixels of ${strip.where} that changed when the whole formation and two ` +
        `bullets were posed onto the play field, over the strip's own ` +
        `frame-to-frame drift of ${String(drift)} — play is drawn inside the ` +
        `play field (specs/field.md)`,
    );
  }
});
