// Facet — drawing one gem.
//
// Every stone on the board is a produced sprite (specs/assets.md): one 64 x 64
// PNG per kind per strain state, one per strain state of the prism, and the
// `brilliant` and `star` treatments as overlays composited over a kind's
// sprite. They are pixel art drawn at native size, so they are drawn at native
// size here too and sampled nearest-neighbor — the runtime clears
// `imageSmoothingEnabled` at the top of every frame.
//
// THE PRISM TURNS. `gems/prism-turn/` is an eight-frame loop of the cut
// rotating and catching the light, and it is the sprite a prism at strain `0`
// is drawn from, so a prism is picked out of the stones around it by its
// motion as well as its art. A prism that has taken strain is drawn from its
// own damaged sprite instead: the turn sheet carries no damage, and a flawed
// stone reading as flawed matters more than a flawed stone turning.
//
// A sprite that has not arrived yet draws the fallback at the bottom of this
// file — a plain disc in the kind's hue. It is what a cell reads as for the
// handful of frames between the first paint and the sprite landing, and it is
// deliberately nothing like the produced art, so a build that had somehow lost
// its sprites would look obviously wrong rather than quietly plausible.

import {
  CUT_BRILLIANT_KEY,
  CUT_STAR_KEY,
  gemKey,
  prismKey,
  prismTurnKey,
  type AssetStore,
} from "./assets";
import { GEM_R, MAX_STRAIN } from "./constants";
import { prismTurnFrame } from "./effects";
import { COLOR, KIND_FALLBACK, SPRITE_SIZE } from "./theme";
import type { Gem } from "./core";

/** The sprite a gem is drawn from, given the game time the turn is read at. */
export function spriteKeyFor(gem: Gem, simTime: number): string {
  const strain = Math.min(Math.max(gem.strain, 0), MAX_STRAIN);
  if (gem.cut === "prism") {
    return strain === 0
      ? prismTurnKey(prismTurnFrame(simTime))
      : prismKey(strain);
  }
  return gemKey(gem.kind ?? "", strain);
}

/** The overlay a cut composites over the gem, or `null` for a plain gem. */
export function overlayKeyFor(gem: Gem): string | null {
  if (gem.cut === "brilliant") return CUT_BRILLIANT_KEY;
  if (gem.cut === "star") return CUT_STAR_KEY;
  return null;
}

/**
 * One gem, centered on `(x, y)` — a cell center from `specs/board.md` — with
 * its kind, its cut, and its strain all readable.
 */
export function drawGem(
  ctx: CanvasRenderingContext2D,
  assets: AssetStore,
  gem: Gem,
  x: number,
  y: number,
  simTime: number,
): void {
  const body = assets.image(spriteKeyFor(gem, simTime));
  if (body === null) {
    drawFallbackGem(ctx, gem, x, y);
  } else {
    ctx.drawImage(
      body,
      x - SPRITE_SIZE / 2,
      y - SPRITE_SIZE / 2,
      SPRITE_SIZE,
      SPRITE_SIZE,
    );
  }
  const overlayKey = overlayKeyFor(gem);
  if (overlayKey === null) return;
  const overlay = assets.image(overlayKey);
  if (overlay === null) return;
  ctx.drawImage(
    overlay,
    x - SPRITE_SIZE / 2,
    y - SPRITE_SIZE / 2,
    SPRITE_SIZE,
    SPRITE_SIZE,
  );
}

/**
 * The loading fallback: a plain disc in the kind's hue, inside `GEM_R` of the
 * cell center like every other gem form. Never the shipped look — see the
 * header.
 */
export function drawFallbackGem(
  ctx: CanvasRenderingContext2D,
  gem: Gem,
  x: number,
  y: number,
): void {
  const hue =
    gem.kind === null ? "#dfe6f2" : (KIND_FALLBACK[gem.kind] ?? COLOR.textDim);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(x, y, GEM_R * 0.7, 0, Math.PI * 2);
  ctx.fillStyle = hue;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.stroke();
  ctx.restore();
}
