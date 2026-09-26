// presentation/filament-strip-placed-on-the-midpoint — the strip sits between the
// two motes it joins, at the canvas it was authored on.
//
// THE RULE. The Filaments row of `specs/assets.md` (The sprites) states the canvas
// — `48 x 16` — and where the strip goes: "centered on the midpoint between the two
// motes' centers and turned to the angle from the first to the second". Scale fixes
// the size it is drawn at: "Every sprite is authored at the canvas its table row
// states and drawn at that size in logical units, centered on the thing it depicts,
// so nothing is scaled at draw time." And the paragraph under the table says what
// the `48` is: "A filament joins motes on adjacent hexes and a constellation is
// rigid, so the strip spans exactly `HEX_PITCH` (`48`) at every moment and is drawn
// at native size." `specs/field.md` fixes the hex centres the midpoint is taken
// between.
//
// WHAT IT READS. The destination rectangle the draw named, mapped through the
// transform in force at it: its centre against the midpoint of the two hex centres,
// and its two sides against `FILAMENT_SPRITE_W` (`48`) and `FILAMENT_SPRITE_H`
// (`16`). The sides are read back through the turn the draw was made under, so a
// build that draws the strip rotated is measured along the strip and across it
// rather than along the stage.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the
// completion switch held off, a live run, an EMPTY FIELD — with two motes spawned
// back on `(0, 0)` and `(1, 0)` and one filament of weight `1` between them, and
// nothing else. The pair runs east, which is `DIRS[0]`, so the midpoint is
// `HEX_PITCH / 2` from each mote's centre.
//
// WHAT IT DOES NOT DECIDE. Which of the two produced strips a weight is drawn from
// is `filament-drawn-from-plain-strip` and `triune-filament-drawn-from-triune-strip`;
// the angle a strip is turned to is `filament-turned-to-its-motes`. This point
// decides where the strip's centre lands and how big it is drawn.
//
// THE TOLERANCE is one logical unit, which `specs/assets.md` (Scale) makes one
// screen pixel at the reference `1280`-pixel fit.
//
// THE EVIDENCE is the frame the measurement was taken off, written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import { FILAMENT_SPRITE_H, FILAMENT_SPRITE_W, HEX_PITCH } from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  spawnConstellation,
  type Harness,
  type ImageDraw,
} from "../harness";
import { FILAMENT_SPRITES } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** One logical unit: one screen pixel at the reference fit (`specs/assets.md`). */
const PLACEMENT_TOLERANCE = 1;

/** The two hexes the filament joins, adjacent along `DIRS[0]`, and the motes on them. */
const FIRST = at(0, 0);
const SECOND = at(1, 0);
const TYPE = "dust";

/**
 * The destination rectangle's own two sides, read back through the turn it was
 * drawn under.
 *
 * `dw` and `dh` are the destination's diagonal mapped through the transform, so
 * rotating that diagonal back by the angle in force recovers the span ALONG the
 * strip and the span ACROSS it, whichever way the strip was turned.
 */
function spanOf(draw: ImageDraw): { along: number; across: number } {
  const radians = (draw.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    along: Math.abs(draw.dw * cos + draw.dh * sin),
    across: Math.abs(draw.dh * cos - draw.dw * sin),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the strip at 48 x 16 centred on the midpoint of the two hex centres", async () => {
  await openBareRun(h, { challenge: BARE });
  await spawnConstellation(
    h,
    [
      { hex: FIRST, type: TYPE },
      { hex: SECOND, type: TYPE },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  const calls = await h.frameCalls();
  await captureStill(h, "midpoint");

  const readings = await decodeProduced(FILAMENT_SPRITES);
  const strips = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${FILAMENT_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  const first = hexCenter(FIRST);
  const second = hexCenter(SECOND);
  const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };

  let painted: ImageDraw | null = null;
  let away = Number.POSITIVE_INFINITY;
  for (const draw of imageDraws(calls)) {
    const drawn = await h.imagePixels(draw.image.id);
    if (drawn === null) continue;
    if (!strips.some((sprite) => sameAsDrawn(sprite, drawn))) continue;
    const distanceOff = distance({ x: draw.cx, y: draw.cy }, midpoint);
    if (distanceOff < away) {
      painted = draw;
      away = distanceOff;
    }
  }
  if (painted === null) {
    fail(
      "an image draw of a produced filament strip somewhere in the frame",
      "the frame drew neither strip",
    );
  }

  assertNear(
    painted.cx,
    midpoint.x,
    PLACEMENT_TOLERANCE,
    "the stage x the strip is centred on, against the midpoint between the two motes' centres",
  );
  assertNear(
    painted.cy,
    midpoint.y,
    PLACEMENT_TOLERANCE,
    "the stage y the strip is centred on, against the midpoint between the two motes' centres",
  );

  const span = spanOf(painted);
  assertNear(
    span.along,
    FILAMENT_SPRITE_W,
    PLACEMENT_TOLERANCE,
    `the logical units the strip was drawn across along its length, which is HEX_PITCH (${HEX_PITCH}) between adjacent hexes`,
  );
  assertNear(
    span.across,
    FILAMENT_SPRITE_H,
    PLACEMENT_TOLERANCE,
    "the logical units the strip was drawn across its width",
  );
});
