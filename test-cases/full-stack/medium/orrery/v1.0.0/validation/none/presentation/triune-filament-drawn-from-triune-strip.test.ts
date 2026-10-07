// presentation/triune-filament-drawn-from-triune-strip — a filament of weight 3 is
// painted from the heavier of the two produced strips.
//
// THE RULE. The Filaments row of `specs/assets.md` (The sprites) names two files —
// "`assets/sprites/filaments/plain.png`, `triune.png`" — and the art bar says why
// there are two: "The triune strip reads as clearly heavier than the plain one at a
// glance." `specs/field.md` fixes which filament is which: "It carries a `weight`
// of `1` or `3`; a weight of `3` is a triune filament, created only as
// `specs/sigils.md` describes", and `specs/field.md`'s Presentation asks that "a
// triune filament reads as clearly heavier than a plain one" on the field. That is
// only reachable if the weight `3` filament is the one drawn from `triune.png`.
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path, so this
// reads the source back through `Harness.imagePixels` and compares it with the two
// committed strips. The one the frame drew nearest the triune filament's midpoint
// is the one that filament is painted from.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the
// completion switch held off, a live run, an EMPTY FIELD — with two pairs of motes
// spawned back on opposite sides of the field: two `nova` on `(-3, -1)` and
// `(-2, -1)` joined by a filament of weight `3`, and two `luna` on `(1, 2)` and
// `(2, 2)` joined by one of weight `1`. Both are posed because the point is that a
// triune "is told from a plain one on the field"; only the triune one is asserted
// about, and the two are far enough apart that neither strip is the nearer draw to
// the other's midpoint.
//
// THE EVIDENCE is that frame — the triune filament beside the plain one — written
// before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { FILAMENT_SPRITE_PATHS } from "../constants";
import { at, distance, hexCenter, type Hex } from "../field";
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

/** The triune pair: two `nova`, which is the pair `specs/sigils.md` joins at weight 3. */
const TRIUNE: readonly Hex[] = [at(-3, -1), at(-2, -1)];

/** The plain pair, far enough away that its strip is nowhere near the other midpoint. */
const PLAIN: readonly Hex[] = [at(1, 2), at(2, 2)];

/** The midpoint between two hex centres, which is where a strip belongs. */
function midpointOf(pair: readonly Hex[]): { x: number; y: number } {
  const first = hexCenter(pair[0]);
  const second = hexCenter(pair[1]);
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the weight 3 filament from the triune strip", async () => {
  await openBareRun(h, { challenge: BARE });
  await spawnConstellation(
    h,
    [
      { hex: TRIUNE[0], type: "nova" },
      { hex: TRIUNE[1], type: "nova" },
    ],
    [{ a: 0, b: 1, weight: 3 }],
  );
  await spawnConstellation(
    h,
    [
      { hex: PLAIN[0], type: "luna" },
      { hex: PLAIN[1], type: "luna" },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  const calls = await h.frameCalls();
  await captureStill(h, "triune");

  const readings = await decodeProduced(FILAMENT_SPRITES);
  const strips = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${FILAMENT_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  const midpoint = midpointOf(TRIUNE);
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
    assetFile(FILAMENT_SPRITE_PATHS.triune),
    "the produced strip the frame drew nearest the weight 3 filament's midpoint",
  );
});
