// presentation/charge-glyphs — the five charges stay tellable apart with colour
// removed, because each carries a glyph of its own.
//
// THE REQUIREMENT. `specs/overview.md` — "The charges": each charge "carries a
// glyph of its own, so a player tells the five apart without relying on color".
// `specs/assets.md` puts the glyph in the produced file: "The five cores fill
// their canvas as round, faceted mineral, each carrying the color and the glyph
// its charge is drawn with".
//
// WHAT IS READ. The produced sprite's OWN pixels, at the 28 x 28 the case's
// asset table fixes, reached by the identity of the image the frame drew at each
// posed core rather than by any path: `specs/assets.md` has every produced file
// resolved through the bundler, and a bundler inlines a small PNG as a `data:`
// URI. Each sprite is reduced to a binary mask at its own median luminance, which
// is the shape it draws with the hue taken out — two sprites that differ only in
// colour reduce to the same mask, and two that carry different glyphs do not.
//
// THE BOUND. Every pair of masks differs on more than 15% of the sprite's 784
// pixels. The specification fixes a glyph per charge and no glyph's size, so the
// bound has to stand for "a mark a player can tell from another mark at 28
// units": 15% is 118 pixels, about the area of a stroke drawn across a third of
// the sprite, which is the smallest mark that reads at this size. Two sprites
// that differ by hue alone score 0 here, and two whose only difference is a
// shading pass score a few percent, so the bound sits far above the failure it
// has to catch. It is deliberately well below what a real pair of glyphs
// reaches, because how large a build draws its glyphs is the build's own choice.

import { afterEach, beforeEach, it } from "vitest";
import {
  CHARGE_IDS,
  CORE_SPRITE,
  GLYPH_DIFFERENCE_MIN,
  SPRITE_CENTRE_TOL,
} from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTruthy,
} from "../assert";
import {
  captureStill,
  createHarness,
  luminanceMask,
  maskDifference,
  type Harness,
  type PixelRect,
} from "../harness";
import { poseFiveCharges } from "./charges";
import { coreDraws, spriteAt } from "./readouts";

/**
 * How far the sprite's centre may sit from the core's own point and still be
 * that core's sprite: `specs/channel.md` draws a core as a disc of `CORE_RADIUS`
 * centred on the point its arc position gives, and `specs/assets.md` has the
 * sprite fill its 28 x 28 canvas, so the two share a centre. One core radius of
 * slack takes rounding and any framing the build chose, and the posed cores
 * stand 120 units apart, so no core can claim its neighbour's sprite.
 */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a glyph of its own on each charge's core sprite", async () => {
  await poseFiveCharges(h);
  await captureStill(h, "glyphs");

  const drawn = coreDraws(await h.lastCalls());
  const posed = await h.snapshot();
  assertEqual(
    posed.train.length,
    CHARGE_IDS.length,
    "the cores one core of each charge put on the channel",
  );

  const masks: { charge: string; mask: boolean[] }[] = [];
  for (const core of posed.train) {
    const id = spriteAt(drawn, { x: core.x, y: core.y }, SPRITE_CENTRE_TOL);
    assertNotNull(
      id,
      `a produced 28 x 28 sprite drawn at the ${core.charge} core`,
    );
    const pixels = await h.imagePixels(id as number);
    assertTruthy(pixels, `the pixels of the ${core.charge} core sprite`);
    const rect = pixels as PixelRect;
    assertEqual(
      rect.width * rect.height,
      CORE_SPRITE * CORE_SPRITE,
      `the pixels of the ${core.charge} core sprite`,
    );
    masks.push({ charge: core.charge, mask: luminanceMask(rect) });
  }

  for (let i = 0; i < masks.length; i += 1) {
    for (let j = i + 1; j < masks.length; j += 1) {
      assertGreaterThan(
        maskDifference(masks[i].mask, masks[j].mask),
        GLYPH_DIFFERENCE_MIN,
        `the share of pixels the ${masks[i].charge} and ${masks[j].charge} sprites differ on, with colour removed`,
      );
    }
  }
});
