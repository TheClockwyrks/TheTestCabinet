// Floe — the strait itself, drawn in code.
//
// `specs/assets.md` lists what no folder covers: the strait's five bands, the
// bays open and filled, and the splash and spray a death leaves behind. None of
// it is a sprite and none of it is a shape the built-in components can state as
// one figure, so each is a `DrawComponent` — the engine's direct-drawing path,
// called in its place in the layer order with the context already carrying the
// world-to-device transform, so everything below is in stage units
// (engine/rendering.md).
//
// Both components read the live game state at the draw and write nothing, so the
// dependency runs one way (specs/instrumentation.md).

import {
  Actor,
  DrawComponent,
  type DrawApi,
} from "@test-cabinet/structured-2d";
import {
  BAY_COUNT,
  ICE_BOTTOM,
  ICE_TOP,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_W,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
  tileLeft,
  tileTop,
} from "./constants";
import { bayColumns } from "./grid";
import { floeState } from "./game";
import { BEAR_LUNGE_BASE, art } from "./sprites";
import { BEAR_LUNGE_FPS, COLOR, LAYER, beat } from "./theme";

/** A row band, as a stage rectangle. */
function bandRect(
  fromRow: number,
  toRow: number,
): [number, number, number, number] {
  const top = tileTop(fromRow);
  return [0, top, STAGE_W, tileTop(toRow + 1) - top];
}

/** The five bands and the five bays (specs/strait.md, specs/bays.md). */
class BandsArt extends DrawComponent {
  draw(api: DrawApi): void {
    const { ctx } = api;
    // The first thing drawn each frame, on the lowest layer, so this is where
    // the frame's sampling is chosen: the seeded art is pixel art and has to
    // stay crisp at every scale the stage is fitted to (specs/assets.md).
    // Nothing between here and the end of the frame resets it, so every sprite
    // the pipeline draws afterwards is sampled the same way.
    ctx.imageSmoothingEnabled = false;
    if (api.mode === "wireframe") {
      ctx.strokeStyle = COLOR.textDim;
      ctx.lineWidth = 1;
      for (const band of [
        bandRect(ROW_CAP, ROW_BAYS),
        bandRect(WATER_TOP, WATER_BOTTOM),
        bandRect(ROW_MEDIAN, ROW_MEDIAN),
        bandRect(ICE_TOP, ICE_BOTTOM),
        bandRect(ROW_NEAR, ROW_NEAR),
      ]) {
        ctx.strokeRect(...band);
      }
      return;
    }

    // Each band a flat tint far from every other band's (specs/overview.md).
    ctx.fillStyle = COLOR.water;
    ctx.fillRect(...bandRect(WATER_TOP, WATER_BOTTOM));
    // A slightly deeper tint down the middle of each water row, so the drift
    // reads as water rather than as a flat panel.
    ctx.fillStyle = COLOR.waterDeep;
    for (let row = WATER_TOP; row <= WATER_BOTTOM; row += 1) {
      ctx.fillRect(0, tileTop(row) + TILE - 3, STAGE_W, 3);
    }

    ctx.fillStyle = COLOR.farShore;
    ctx.fillRect(...bandRect(ROW_CAP, ROW_BAYS));
    ctx.fillStyle = COLOR.farShoreEdge;
    ctx.fillRect(0, tileTop(ROW_BAYS + 1) - 3, STAGE_W, 3);

    ctx.fillStyle = COLOR.median;
    ctx.fillRect(...bandRect(ROW_MEDIAN, ROW_MEDIAN));

    ctx.fillStyle = COLOR.iceBand;
    ctx.fillRect(...bandRect(ICE_TOP, ICE_BOTTOM));
    ctx.fillStyle = COLOR.iceBandLine;
    for (let row = ICE_TOP; row <= ICE_BOTTOM; row += 1) {
      ctx.fillRect(0, tileTop(row), STAGE_W, 1);
    }

    ctx.fillStyle = COLOR.nearShore;
    ctx.fillRect(...bandRect(ROW_NEAR, ROW_NEAR));

    this.drawBays(ctx);
  }

  /** The five bays cut into the far shore, open or filled (specs/bays.md). */
  private drawBays(ctx: CanvasRenderingContext2D): void {
    const { bays } = floeState(this.world);
    for (let bay = 0; bay < BAY_COUNT; bay += 1) {
      const [left] = bayColumns(bay);
      const x = tileLeft(left);
      const y = tileTop(ROW_BAYS);
      ctx.fillStyle = bays[bay] ? COLOR.bayFilled : COLOR.bayOpen;
      ctx.fillRect(x, y, TILE * 2, TILE);
      if (!bays[bay]) continue;
      // A filled bay reads as packed rather than open: two blocks of shore ice
      // set into the gold.
      ctx.fillStyle = COLOR.farShore;
      ctx.fillRect(x + 6, y + 8, TILE - 6, TILE - 16);
      ctx.fillRect(x + TILE + 2, y + 8, TILE - 6, TILE - 16);
    }
  }
}

/**
 * What a death leaves behind: the splash of a fall, the spray of a crush, and
 * the bear's lunge (specs/water.md, specs/ice.md, specs/assets.md).
 *
 * The lunge is the one of the three that is drawn from the seeded art. It is
 * drawn here rather than by the bear because the catch takes every bear off the
 * strait on the tick it costs the life, so by the time the frame draws there is
 * no bear left to carry it.
 */
class EffectsArt extends DrawComponent {
  draw(api: DrawApi): void {
    const { ctx } = api;
    const state = floeState(this.world);
    for (const effect of state.effects) {
      const life = Math.max(0, Math.min(1, effect.life / effect.span));
      ctx.globalAlpha = api.mode === "shaded" ? life : 1;
      if (effect.kind === "lunge") {
        const frame =
          art().bear[BEAR_LUNGE_BASE + beat(state.simTime, BEAR_LUNGE_FPS)];
        if (frame !== null) {
          ctx.drawImage(
            frame,
            effect.x - TILE / 2,
            effect.y - TILE / 2,
            TILE,
            TILE,
          );
        }
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = effect.kind === "splash" ? COLOR.splash : COLOR.spray;
      ctx.lineWidth = 3;
      for (const ring of [0, 1]) {
        const radius = 6 + (1 - life) * (18 + ring * 10);
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
}

/** The strait: the bands beneath everything, and the effects over the bodies. */
export class Strait extends Actor {
  constructor() {
    super();
    this.attach(new BandsArt()).layer = LAYER.bands;
    this.attach(new EffectsArt()).layer = LAYER.effects;
  }
}
