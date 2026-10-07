// presentation/each-mote-type-draws-its-own-sprite — fifteen types on the field,
// fifteen pictures, each type drawn with the file produced for it.
//
// THE RULE. The Motes row of `specs/assets.md` (The sprites) names one file per
// type — "`assets/sprites/motes/<type>.png`, one for each of the fifteen names in
// `MOTES`" — drawn "centered on every mote's position". One file per name is what
// makes the art bar's "The fifteen mote sprites are pairwise distinguishable on
// the field without reading a label" reachable at all: a player tells a `sol` from
// a `dust` because the two are drawn from two different files. `specs/field.md`
// asks for the same thing of the field itself — "Every one of the fifteen mote
// types is identifiable at a glance" (Presentation).
//
// WHAT IT READS. One mote of every type is posed on its own hex, and for each of
// them the source the frame drew there is read back through
// `Harness.imagePixels` and compared with all fifteen committed files over the
// disc of `MOTE_R` (`22`) about the canvas centre — which is the mote's own
// position, and which the art bar puts every one of its painted pixels inside.
// The type's own file must differ from what was drawn by strictly LESS than each
// of the other fourteen. So a build that shipped one picture fifteen times, or
// that drew `dust` with `sol`'s file, fails on the pair that collides, and a build
// that drew its fifteen files where its fifteen types are passes whatever it drew.
//
// WHY "MORE CLOSELY" RATHER THAN "EXACTLY". The comparison is a ranking rather
// than an identity, so nothing here turns on how a decoder or a canvas rounded a
// channel; what it decides is that no two types share a picture and none is drawn
// with another's.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the
// completion switch held off, a live run, an EMPTY FIELD — with fifteen motes
// spawned back on fifteen hexes of the field, in `MOTES` order, and nothing else.
// The hexes are two apart along a row and two rows apart, so the nearest pair of
// centres is `HEX_PITCH` (`48`) times two and no mote's disc of `MOTE_R` can
// reach another's.
//
// THE EVIDENCE is the whole roster in one frame, written before the assertions,
// so a reviewer reads the fifteen pictures beside the verdict about them.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan, fail } from "../assert";
import { MOTES, MOTE_R } from "../constants";
import { at, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  CHANNEL_EPSILON,
  captureStill,
  createHarness,
  imagesNear,
  openBareRun,
  spawnMote,
  type Harness,
  type PixelRect,
} from "../harness";
import { MOTE_SPRITES } from "../assets/files";
import { decodeProduced, type Sprite } from "../assets/sprites";

/**
 * A hex for each of the fifteen names of `MOTES`, in that order: three to a row,
 * two hexes apart, on five rows two apart.
 *
 * Every one is on the field — `max(|q|, |r|, |q + r|) <= FIELD_R` (`5`),
 * `specs/field.md` — and no two are adjacent, so no mote's `MOTE_R` disc can
 * reach another's and each reading below is about one mote.
 */
const SPOTS: readonly Hex[] = [
  at(0, -4),
  at(2, -4),
  at(4, -4),
  at(-1, -2),
  at(1, -2),
  at(3, -2),
  at(-2, 0),
  at(0, 0),
  at(2, 0),
  at(-3, 2),
  at(-1, 2),
  at(1, 2),
  at(-4, 4),
  at(-2, 4),
  at(0, 4),
];

/**
 * How much of the disc of `MOTE_R` about the canvas centre is not the same pixel
 * in a produced file and in a source the frame drew, as a share of that disc.
 *
 * The same comparison `assets/sprites.ts` makes over a whole canvas, narrowed to
 * the disc this point names. Two clear pixels are the same pixel whatever colour
 * bytes sit under them, because a straight-alpha canvas leaves those bytes
 * undefined. Two canvases of different sizes are wholly different, since no pixel
 * of one is the pixel of the other.
 */
function differingWithin(sprite: Sprite, drawn: PixelRect): number {
  if (sprite.width !== drawn.width || sprite.height !== drawn.height) return 1;
  const cx = (sprite.width - 1) / 2;
  const cy = (sprite.height - 1) / 2;
  const left = sprite.pixels.data;
  const right = drawn.data;
  let inside = 0;
  let differing = 0;
  for (let y = 0; y < sprite.height; y += 1) {
    for (let x = 0; x < sprite.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > MOTE_R * MOTE_R) continue;
      inside += 1;
      const i = (y * sprite.width + x) * 4;
      const alphaA = left[i + 3];
      const alphaB = right[i + 3];
      if (Math.abs(alphaA - alphaB) > CHANNEL_EPSILON) {
        differing += 1;
        continue;
      }
      if (alphaA === 0 && alphaB === 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        if (
          Math.abs(left[i + channel] - right[i + channel]) > CHANNEL_EPSILON
        ) {
          differing += 1;
          break;
        }
      }
    }
  }
  return inside === 0 ? 1 : differing / inside;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each of the fifteen types with the file produced for that type", async () => {
  await openBareRun(h, { challenge: BARE });
  for (const [index, type] of MOTES.entries()) {
    await spawnMote(h, SPOTS[index], type);
  }

  const calls = await h.frameCalls();
  await captureStill(h, "roster");

  const readings = await decodeProduced(MOTE_SPRITES);
  const sprites = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${MOTE_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  for (const [index, type] of MOTES.entries()) {
    const near = imagesNear(calls, hexCenter(SPOTS[index]), MOTE_R);
    assertGreaterThan(
      near.length,
      0,
      `${type}: image draws the frame centred within MOTE_R (22) of that mote's position`,
    );

    // The sprite the frame drew on this hex: of the sources centred on it, the
    // one nearest to any of the fifteen files. A build drawing something else
    // over its motes as well is still drawing its motes.
    let best: number[] | null = null;
    for (const draw of near) {
      const drawn = await h.imagePixels(draw.image.id);
      if (drawn === null) continue;
      const shares = sprites.map((sprite) => differingWithin(sprite, drawn));
      if (best === null || Math.min(...shares) < Math.min(...best)) {
        best = shares;
      }
    }
    if (best === null) {
      fail(
        `${type}: the pixels of a source the frame drew on that mote's position`,
        "no source the harness could read back",
      );
    }

    for (const [other, otherType] of MOTES.entries()) {
      if (other === index) continue;
      assertLessThan(
        best[index],
        best[other],
        `${type}: the share of its MOTE_R disc differing from ${type}.png, against the share differing from ${otherType}.png`,
      );
    }
  }
});
