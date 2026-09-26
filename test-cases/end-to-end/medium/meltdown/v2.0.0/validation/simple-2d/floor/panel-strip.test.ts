// floor/panel-strip — the panel's readouts are drawn in the right-hand
// strip and not on the floor.
//
// THE RULE. `specs/floor.md` divides the stage into two regions and states what
// each holds: the reactor over `x` in `[0, REACTOR_W]` and the build panel over
// `x` in `[PANEL_X, 1280]`, `PANEL_W` (`294`) wide, full height, holding "every
// readout and every control `specs/hud.md` states". Then it states the boundary
// twice, once in each direction: "Play is confined to the reactor region: no
// tower, no surge unit, and no on-floor read is drawn in the panel's strip, and
// no panel readout or control is drawn on the floor."
//
// THIS ITEM IS THE PANEL'S HALF OF THAT BOUNDARY: a readout's value is changed,
// the strip changes with it, and the floor does not. The floor's half — that
// nothing of play is drawn in the strip — is `floor.no-floor-in-the-strip`'s, and
// that every control the panel REPORTS lies inside the strip is
// `hud.touch-targets`'s, which reads the same rectangles for its own reason. Each
// is a thing a build can get wrong on its own.
//
// WHY EVERY COMPARISON IS BETWEEN TWO FRAMES OF THE SAME BUILD. `specs/overview.md`
// fixes no palette: what the panel looks like, what the floor looks like, and
// whether the two are near each other in colour are all the build's, and a build
// is free to paint a dark panel beside a dark floor with a hairline between them.
// So nothing here samples a colour and says what it should be. The check poses two
// states that differ in exactly one thing, and asks whether the pixels moved where
// that thing lives and stayed still where it does not.
//
// WHAT IS NOT DECIDED HERE, AND WHY. That the strip is PAINTED — that the panel's
// own ground covers `[986, 1280]` for the full height rather than leaving the
// stage's clear colour showing through — is not decidable from out here without
// fixing a palette the specification deliberately leaves free: a build whose panel
// ground is within a few units of its stage background is conformant, and this
// case's own reference is such a build.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  FLOOR_X0,
  FLOOR_X1,
  FLOOR_Y0,
  FLOOR_Y1,
  PANEL_X,
  STAGE_H,
  STAGE_W,
} from "../constants";
import type { Point } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  startRun,
  type Harness,
  type Rgb,
} from "../harness";
import { pixelsAt } from "./read";

/**
 * How far a pixel must move, out of the 441 the RGB cube spans, to count as
 * having been redrawn.
 *
 * The same figure `floor/grid-visible` and `floor/tile-map` use for a step a
 * player can see: under two per cent of the scale. Low, because a readout this
 * check missed would be a readout the item was meant to find — a money figure
 * redrawn from nothing to four digits moves those pixels a long way further than
 * this.
 */
const REDRAWN_MIN = 8;

/**
 * How far above a pair of identical frames' own movement a pixel must move, on
 * top of {@link REDRAWN_MIN}, to count.
 *
 * A build is free to animate its panel — a pulsing Send, a glowing shop entry —
 * and that movement is not a readout changing. So the check first measures how
 * still each region is when NOTHING changed, and holds the real reading to that
 * plus this margin.
 */
const NOISE_MARGIN = REDRAWN_MIN;

/** The build timer both frames of a pair are posed at, so the panel reads alike. */
const PINNED_TIMER = 10.5;

/** The money the panel is read at before it is made rich. */
const BROKE = 0;

/** The money the panel is read at after: past every tower's cost. */
const RICH = 9_999;

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
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
  captureStill(h, "panel");

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
