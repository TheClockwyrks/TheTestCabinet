// Meltdown — floor/no-floor-in-the-strip — nothing of the floor is drawn in the panel's
// strip, even with play crowded against its edge.
//
// THE RULE. `specs/floor.md` divides the stage into the reactor over `x` in
// `[0, REACTOR_W]` and the build panel over `x` in `[PANEL_X, 1280]`, and states
// the boundary in this direction outright: "Play is confined to the reactor
// region: no tower, no surge unit, and no on-floor read is drawn in the panel's
// strip".
//
// THIS ITEM IS THE FLOOR'S HALF OF THAT BOUNDARY. The panel's half — that its
// readouts are drawn in the strip and not on the floor — is `floor.panel-strip`'s,
// and that every control the panel reports lies inside the strip is
// `hud.touch-targets`'s. A build that clips its floor and a build that draws its
// panel in the wrong place are different defects, so each is its own point.
//
// WHY EVERY COMPARISON IS BETWEEN TWO FRAMES OF THE SAME BUILD. `specs/overview.md`
// fixes no palette: what the panel looks like, what the floor looks like, and
// whether the two are near each other in colour are all the build's, and a build
// is free to paint a dark panel beside a dark floor with a hairline between them.
// So nothing here samples a colour and says what it should be. The check poses two
// states that differ in exactly one thing, and asks whether the pixels moved where
// that thing lives and stayed still where it does not.
//
// AND WHY THE PAIR IS COUNTED-EQUAL. The two frames carry the SAME number of
// towers and the SAME number of units, and the build timer is re-posed to the same
// value before each; only the positions differ. That matters because a panel is
// entitled to draw things this item is not about — a timer counting down, an extra
// tally a build chose to show — and a check that compared a floor with eight units
// against a floor with none would read those as a spill.
//
// WHAT IS NOT DECIDED HERE, AND WHY. That the strip is PAINTED — that the panel's
// own ground covers `[986, 1280]` for the full height rather than leaving the
// stage's clear colour showing through — is not decidable from out here without
// fixing a palette the specification deliberately leaves free: a build whose panel
// ground is within a few units of its stage background is conformant, and this
// case's own reference is such a build.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { COLS, PANEL_X, STAGE_H, STAGE_W, tileCX, tileCY } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  type Harness,
  type Point,
  type Rgb,
} from "../harness";
import { pixelsAt } from "./read";

/**
 * How far a pixel must move, out of the 441 the RGB cube spans, to count as
 * having been redrawn.
 *
 * The same figure `floor/grid-visible` and `floor/tile-map` use for a step a
 * player can see: under two per cent of the scale. Low, because this check is
 * looking for a spill and a spill it missed would be a spill the item was meant
 * to catch — a tower's edge drawn a few units into the strip moves those
 * pixels a long way further than this.
 */
const REDRAWN_MIN = 8;

/**
 * How far above a pair of identical frames' own movement a pixel must move, on
 * top of {@link REDRAWN_MIN}, to count.
 *
 * A build is free to animate its panel — a pulsing Send, a glowing shop entry —
 * and that movement is not a spill. So the check first measures how still the
 * strip is when NOTHING changed, and holds the real reading to that plus this
 * margin.
 */
const NOISE_MARGIN = REDRAWN_MIN;

/** The build timer both frames of a pair are posed at, so the panel reads alike. */
const PINNED_TIMER = 10.5;

/** The hp every posed unit carries, so nothing on the floor can die mid-reading. */
const TARGET_HP = 10_000;

/** Anchors on the middle of the floor, and the same count hard against its edge. */
const MID_TOWERS: readonly { col: number; row: number }[] = [
  { col: 20, row: 4 },
  { col: 20, row: 12 },
  { col: 20, row: 22 },
  { col: 20, row: 30 },
];
const EDGE_TOWERS: readonly { col: number; row: number }[] = [
  { col: 47, row: 4 },
  { col: 47, row: 12 },
  { col: 47, row: 22 },
  { col: 47, row: 30 },
];

/** Where the surge stands in each of the two frames. */
const MID_UNITS: readonly { col: number; row: number }[] = [
  { col: 18, row: 6 },
  { col: 18, row: 14 },
  { col: 18, row: 24 },
  { col: 18, row: 32 },
];
const EDGE_UNITS: readonly { col: number; row: number }[] = [
  { col: COLS - 1, row: 6 },
  { col: COLS - 1, row: 14 },
  { col: COLS - 1, row: 24 },
  { col: COLS - 1, row: 32 },
];

/**
 * How far apart two samples of a region are, in logical units.
 *
 * Finer than the smallest thing either region draws that this item is about, so
 * nothing it is looking for can fall between two samples: a numeral at a readout
 * size is around twenty units across and thirty tall, and a tower's body is two
 * tiles — thirty-eight — across. Ten units is comfortably inside both, and the
 * two grids together are a few thousand points, which is one crossing of the
 * backing store each.
 */
const STRIP_PITCH = 10;

/** The strip, sampled on a grid inset from its edges. */
function stripPoints(): Point[] {
  const points: Point[] = [];
  for (let x = PANEL_X + 4; x <= STAGE_W - 4; x += STRIP_PITCH) {
    for (let y = 4; y <= STAGE_H - 4; y += STRIP_PITCH) points.push({ x, y });
  }
  return points;
}

/** How many of `points` moved between `quiet` and `changed`, past the noise. */
function moved(
  points: readonly Point[],
  first: readonly Rgb[],
  quiet: readonly Rgb[],
  changed: readonly Rgb[],
): { count: number; worst: string } {
  let count = 0;
  let worst = "none";
  let peak = 0;
  for (let i = 0; i < points.length; i += 1) {
    const noise = colorDistance(first[i], quiet[i]);
    const shift = colorDistance(quiet[i], changed[i]);
    if (shift >= REDRAWN_MIN && shift >= noise + NOISE_MARGIN) {
      count += 1;
      if (shift > peak) {
        peak = shift;
        worst =
          `(${points[i].x}, ${points[i].y}) moved ${shift.toFixed(1)} ` +
          `against ${noise.toFixed(1)} of frame-to-frame movement`;
      }
    }
  }
  return { count, worst };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws nothing of the floor in the strip, even hard against its edge", async () => {
  startRun(h);

  const strip = stripPoints();
  const unitIds = MID_UNITS.map((stand) =>
    poseTarget(h, "mote", stand.col, stand.row, TARGET_HP),
  );
  for (const anchor of MID_TOWERS) poseTower(h, "arc", anchor.col, anchor.row);

  h.debug.setBuildTimer(PINNED_TIMER);
  await h.advance(1);
  const first = pixelsAt(h, strip);
  h.debug.setBuildTimer(PINNED_TIMER);
  await h.advance(1);
  const quiet = pixelsAt(h, strip);

  // The same four towers and the same four units, moved to the floor's last
  // column and the two columns before it — as near the boundary as play reaches.
  h.debug.clearTowers();
  for (const anchor of EDGE_TOWERS) poseTower(h, "arc", anchor.col, anchor.row);
  for (const [index, stand] of EDGE_UNITS.entries()) {
    h.debug.setUnitPosition(
      unitIds[index],
      tileCX(stand.col),
      tileCY(stand.row),
    );
  }

  h.debug.setBuildTimer(PINNED_TIMER);
  await h.advance(1);
  const crowded = pixelsAt(h, strip);
  captureStill(h, "strip");

  const spill = moved(strip, first, quiet, crowded);
  assertEqual(
    spill.count,
    0,
    `of ${strip.length} points sampled across the strip, none moves when the ` +
      `towers and the surge move to the floor's right edge (specs/floor.md); ` +
      `worst: ${spill.worst}`,
  );
});
