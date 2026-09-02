// floor/panel-strip — the build panel owns the right-hand strip, and play stays
// out of it.
//
// THE RULE. specs/floor.md divides the stage into two regions and states what
// each holds: the reactor over `x` in `[0, REACTOR_W]` and the build panel over
// `x` in `[PANEL_X, 1280]`, `PANEL_W` (`294`) wide, full height, holding "every
// readout and every control `specs/hud.md` states". Then it states the boundary
// twice, once in each direction: "Play is confined to the reactor region: no
// tower, no surge unit, and no on-floor read is drawn in the panel's strip, and
// no panel readout or control is drawn on the floor." specs/hud.md says the same
// of the controls: every one of them "lies inside the panel's strip".
//
// So the item is one boundary at `x = 986`, and the three checks below cross it
// in the three ways anything can:
//
//   1. WHERE THE PANEL SAYS ITS CONTROLS ARE. Every rectangle the snapshot
//      reports — the eight shop entries, Rotate and Cancel, Upgrade and Sell,
//      Send, the speed toggle, Pause and mute — lies wholly inside the strip.
//   2. WHAT PLAY DRAWS. The towers and the surge are moved from the middle of the
//      floor to hard against its right edge, and nothing in the strip moves.
//   3. WHAT THE PANEL DRAWS. A readout's value is changed, the strip changes with
//      it, and the floor does not.
//
// WHY EVERY COMPARISON IS BETWEEN TWO FRAMES OF THE SAME BUILD. specs/overview.md
// fixes no palette: what the panel looks like, what the floor looks like, and
// whether the two are near each other in colour are all the build's, and a build
// is free to paint a dark panel beside a dark floor with a hairline between them.
// So no check here samples a colour and says what it should be. Each poses two
// states that differ in exactly one thing, and asks whether the pixels moved
// where that thing lives and stayed still where it does not.
//
// AND WHY EACH PAIR IS COUNTED-EQUAL. In check 2 the two frames carry the SAME
// number of towers and the SAME number of units, and the build timer is re-posed
// to the same value before each; only the positions differ. That matters because
// a panel is entitled to draw things this item is not about — a timer counting
// down, an extra tally a build chose to show — and a check that compared a floor
// with eight units against a floor with none would read those as a spill.
//
// WHAT IS NOT DECIDED HERE, AND WHY. Two things.
//
// That the strip is PAINTED — that the panel's own ground covers `[986, 1280]`
// for the full height rather than leaving the stage's clear colour showing
// through — is not decidable from out here without fixing a palette the
// specification deliberately leaves free: a build whose panel ground is within a
// few units of its stage background is conformant.
//
// And what a build draws into the strip and then paints over. Check 2 reads
// PIXELS, so it decides what a player sees; a build that drew a tower's edge a
// few units into the strip and then laid an opaque panel over it shows the player
// nothing and passes. That is the right verdict for a reading about what is
// visible, and it is the only reading available without a palette: which draw
// belongs to the floor and which to the panel is not something a check can tell
// from outside the build. A spill a player can actually see — an on-floor read
// drawn after the panel, or a panel whose ground does not cover its own strip —
// is what the check catches, and it is what the requirement is about.

import { afterEach, beforeEach, it } from "vitest";
import {
  COLS,
  FLOOR_X0,
  FLOOR_X1,
  FLOOR_Y0,
  FLOOR_Y1,
  PANEL_W,
  PANEL_X,
  STAGE_H,
  STAGE_W,
  tileCX,
  tileCY,
} from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import type { Point } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  type Harness,
  type RectSnapshot,
  type Rgb,
} from "../harness";
import { pixelsAt } from "./read";

/**
 * How far a pixel must move, out of the 441 the RGB cube spans, to count as
 * having been redrawn.
 *
 * The same figure `floor/grid-visible` and `floor/tile-map` use for a step a
 * player can see: under two per cent of the scale. Low, because check 2 is
 * looking for a spill and a spill this check missed would be a spill the item was
 * meant to catch — a tower's edge drawn a few units into the strip moves those
 * pixels a long way further than this.
 */
const REDRAWN_MIN = 8;

/**
 * How far above a pair of identical frames' own movement a pixel must move, on
 * top of {@link REDRAWN_MIN}, to count.
 *
 * A build is free to animate its panel — a pulsing Send, a glowing shop entry —
 * and that movement is not a spill. So every check that asks whether the strip
 * stayed still first measures how still it is when NOTHING changed, and holds the
 * real reading to that plus this margin.
 */
const NOISE_MARGIN = REDRAWN_MIN;

/** The build timer both frames of a pair are posed at, so the panel reads alike. */
const PINNED_TIMER = 10.5;

/** The money the panel is read at before it is made rich. */
const BROKE = 0;

/** The money the panel is read at after: past every tower's cost. */
const RICH = 9_999;

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
const FLOOR_PITCH = 10;

/** The strip, sampled on a grid inset from its edges. */
function stripPoints(): Point[] {
  const points: Point[] = [];
  for (let x = PANEL_X + 4; x <= STAGE_W - 4; x += STRIP_PITCH) {
    for (let y = 4; y <= STAGE_H - 4; y += STRIP_PITCH) points.push({ x, y });
  }
  return points;
}

/** The floor, sampled on a grid inset from the casing. */
function floorPoints(): Point[] {
  const points: Point[] = [];
  for (let x = FLOOR_X0 + 4; x <= FLOOR_X1 - 4; x += FLOOR_PITCH) {
    for (let y = FLOOR_Y0 + 4; y <= FLOOR_Y1 - 4; y += FLOOR_PITCH) {
      points.push({ x, y });
    }
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

/** Whether a rectangle lies wholly inside the panel's strip. */
function inStrip(rect: RectSnapshot): boolean {
  return (
    rect.x >= PANEL_X &&
    rect.x + rect.w <= STAGE_W &&
    rect.y >= 0 &&
    rect.y + rect.h <= STAGE_H
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports every one of its controls inside the strip", async () => {
  startRun(h);
  // Every control at once: Rotate and Cancel exist only while a placement is
  // armed, and Upgrade and Sell only while a tower is selected (specs/hud.md), so
  // both are posed and the panel is read with all fourteen drawn.
  const id = poseTower(h, "arc", 20, 12);
  h.debug.setSelected(id);
  h.debug.setArmed("arc");
  await h.advance(1);
  captureStill(h, "panel");

  const { controls } = h.snapshot();
  const named: { name: string; rect: RectSnapshot | null }[] = [
    ...controls.shop.map((entry) => ({
      name: `the ${entry.type} shop entry`,
      rect: entry as RectSnapshot,
    })),
    { name: "Rotate", rect: controls.rotate },
    { name: "Cancel", rect: controls.cancel },
    { name: "Upgrade", rect: controls.upgrade },
    { name: "Sell", rect: controls.sell },
    { name: "Send", rect: controls.send },
    { name: "the speed toggle", rect: controls.speed },
    { name: "Pause", rect: controls.pause },
    { name: "the mute control", rect: controls.mute },
  ];

  for (const { name, rect } of named) {
    if (rect === null) continue;
    assertEqual(
      inStrip(rect),
      true,
      `${name} at (${rect.x}, ${rect.y}) ${rect.w}x${rect.h} lies inside the ` +
        `panel's strip, x [${PANEL_X}, ${STAGE_W}] and ${PANEL_W} wide over ` +
        `the full height (specs/floor.md, specs/hud.md)`,
    );
  }
});

it("draws nothing of the floor in the strip, even hard against its edge", async () => {
  startRun(h);

  const strip = stripPoints();
  const unitIds = MID_UNITS.map((stand) =>
    poseTarget(h, "mote", stand.col, stand.row),
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

  const spill = moved(strip, first, quiet, crowded);
  assertEqual(
    spill.count,
    0,
    `of ${strip.length} points sampled across the strip, none moves when the ` +
      `towers and the surge move to the floor's right edge (specs/floor.md); ` +
      `worst: ${spill.worst}`,
  );
});

it("draws its readouts in the strip and not on the floor", async () => {
  startRun(h);
  const floor = floorPoints();
  const strip = stripPoints();
  const points = [...strip, ...floor];

  h.debug.setMoney(BROKE);
  h.debug.setBuildTimer(PINNED_TIMER);
  await h.advance(1);
  const first = pixelsAt(h, points);
  h.debug.setBuildTimer(PINNED_TIMER);
  await h.advance(1);
  const quiet = pixelsAt(h, points);

  // One panel readout's value, changed: money, which specs/hud.md draws in the
  // panel at all times and which every shop entry's affordable/disabled read
  // follows. Nothing on the floor depends on it. It is taken from nothing to
  // plenty rather than nudged, so the eight shop entries cross the disabled line
  // as well as the digits changing — a build is entitled to draw its readouts
  // small, and one glyph at one spot is a thin thing to hunt for on a grid.
  h.debug.setMoney(RICH);
  h.debug.setBuildTimer(PINNED_TIMER);
  await h.advance(1);
  const richer = pixelsAt(h, points);

  const inside = moved(
    strip,
    first.slice(0, strip.length),
    quiet.slice(0, strip.length),
    richer.slice(0, strip.length),
  );
  assertGreaterThanOrEqual(
    inside.count,
    1,
    `of ${strip.length} points sampled across the strip, at least one moves ` +
      `when the money does, so the panel's readouts are drawn in the strip ` +
      `(specs/floor.md, specs/hud.md)`,
  );

  const outside = moved(
    floor,
    first.slice(strip.length),
    quiet.slice(strip.length),
    richer.slice(strip.length),
  );
  assertLessThanOrEqual(
    outside.count,
    0,
    `of ${floor.length} points sampled across the floor, none moves when the ` +
      `money does, so no panel readout is drawn on the floor ` +
      `(specs/floor.md); worst: ${outside.worst}`,
  );
});
