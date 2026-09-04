// presentation/filament-drawn-from-plain-strip — a plain filament is a produced
// strip put on the canvas, not a line the render draws.
//
// THE RULE. "Every mote, filament, glyph, hub, gripper, mount, and aperture on
// screen is a produced sprite" (`specs/assets.md`, Genuinely produced), and the
// Filaments row of The sprites names the two files: "`assets/sprites/filaments/plain.png`,
// `triune.png`", on a `48 x 16` canvas. `specs/field.md` fixes which of the two a
// filament is: "It carries a `weight` of `1` or `3`; a weight of `3` is a triune
// filament", so a filament of weight `1` is the plain one.
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path — a
// bundler is free to inline a produced PNG as a `data:` URI and that is still the
// committed file — so this reads the source back through `Harness.imagePixels` and
// compares it with the two committed strips. The one the frame drew nearest the
// filament's midpoint is the one that filament is painted from.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the
// completion switch held off, a live run, an EMPTY FIELD — with two motes spawned
// back on `(0, 0)` and `(1, 0)`, adjacent as `specs/field.md` requires of a
// filament's ends, joined by one filament of weight `1`. Nothing else is on the
// field, so the only filament in the frame is the one under test.
//
// WHAT IT DOES NOT DECIDE. Where the strip lands and how large it is drawn is
// `filament-strip-placed-on-the-midpoint`; what a weight of `3` is drawn with is
// `triune-filament-drawn-from-triune-strip`. This point decides one thing: a
// weight `1` filament is painted from `plain.png`.
//
// THE EVIDENCE is the frame the reading was taken off, written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { FILAMENT_SPRITE_PATHS } from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  spawnConstellation,
  type Harness,
} from "../harness";
import { FILAMENT_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** The two hexes the filament joins, and the type of mote on each. */
const FIRST = at(0, 0);
const SECOND = at(1, 0);
const TYPE = "dust";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the weight 1 filament from the plain strip", async () => {
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
  await captureStill(h, "plain");

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

  let painted: { file: string; away: number } | null = null;
  for (const draw of imageDraws(calls)) {
    const drawn = await h.imagePixels(draw.image.id);
    if (drawn === null) continue;
    const strip = strips.find((sprite) => sameAsDrawn(sprite, drawn));
    if (strip === undefined) continue;
    const away = distance({ x: draw.cx, y: draw.cy }, midpoint);
    if (painted === null || away < painted.away) {
      painted = { file: strip.file, away };
    }
  }
  if (painted === null) {
    fail(
      "an image draw of one of the two produced filament strips, rather than a line drawn in code",
      "the frame drew neither strip",
    );
  }

  assertEqual(
    painted.file,
    assetFile(FILAMENT_SPRITE_PATHS.plain),
    "the produced strip the frame drew nearest the weight 1 filament's midpoint",
  );
});
