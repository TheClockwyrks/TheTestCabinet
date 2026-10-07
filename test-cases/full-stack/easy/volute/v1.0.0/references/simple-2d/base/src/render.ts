// Volute — drawing the hall (specs/ui.md, specs/assets.md).
//
// One entry point, `renderFrame`, and it is a PURE READ of the state: it takes
// the game as `DeepReadonly<VoluteState>`, and nothing it does can move the game.
// That is what lets a scenario step the simulation and read the result without
// the picture taking any part in it. The engine has already cleared the canvas to
// `BACKGROUND` and installed the letterboxed fit, so everything below is drawn in
// the field's own logical units.
//
// The layer order is the one `specs/assets.md` fixes: the channel plate under the
// train, the cores with their marks and the injector above it, the sheets and the
// particle effects above those, and the HUD and the screens last.

import {
  CHANNEL,
  CORE_RADIUS,
  FIELD_H,
  FIELD_W,
  INJECTOR_X,
  INJECTOR_Y,
  INJECTOR_RADIUS,
  PROJECTILE_RADIUS,
} from "./constants";
import { INLET, INTAKE, pointAt } from "./channel";
import type { Assets } from "./assets";
import { Effects, recoilFrame } from "./fx";
import {
  drawCleared,
  drawCore,
  drawDanger,
  drawGameOver,
  drawHud,
  drawPaused,
  drawSetback,
  drawSprite,
  drawTitle,
  drawVictory,
  text,
  type View,
} from "./hud";
import { inDanger } from "./sim";
import { CHARGE_COLOR, COLOR, fade } from "./theme";

/** How wide the plate the channel is drawn as stands, in logical units. */
export const PLATE_WIDTH = 40;

/** The reusable plate pattern, built the first time a frame asks for it. */
let platePattern: CanvasPattern | null = null;
let patternSource: CanvasImageSource | null = null;

/** Drop the cached plate pattern, so a fresh engine builds its own. */
export function resetPatternCache(): void {
  platePattern = null;
  patternSource = null;
}

/** Draw one whole frame of the game. */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  state: View,
  assets: Assets,
  effects: Effects,
  dt: number,
): void {
  // Every produced sprite is pixel art at one unit per pixel, so it is sampled
  // nearest-neighbor and stays crisp at whatever the canvas fit turned out to be.
  ctx.imageSmoothingEnabled = false;

  drawChannel(ctx, assets);
  drawIntake(ctx, assets);
  drawTrain(ctx, state, assets);
  drawInjector(ctx, state, assets);
  drawProjectiles(ctx, state, assets);
  if (state.machinery?.kind === "sightline") drawSightline(ctx, state);

  effects.draw(ctx, dt);

  if (
    state.screen === "playing" ||
    state.screen === "paused" ||
    state.screen === "cleared" ||
    state.screen === "setback"
  ) {
    drawHud(ctx, state, assets);
  }
  // The pause draws the hall exactly as the tick that paused it left it, so the
  // warning stands through a pause as well.
  if (
    (state.screen === "playing" || state.screen === "paused") &&
    inDanger(state)
  ) {
    drawDanger(ctx);
  }

  switch (state.screen) {
    case "title":
      drawTitle(ctx, assets);
      break;
    case "paused":
      drawPaused(ctx);
      break;
    case "cleared":
      drawCleared(ctx, state);
      break;
    case "setback":
      drawSetback(ctx, state);
      break;
    case "gameover":
      drawGameOver(ctx, state);
      break;
    case "victory":
      drawVictory(ctx, state);
      break;
    case "playing":
      break;
  }
}

/** The path the channel runs along, walked once. */
function tracePolyline(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(CHANNEL[0].x, CHANNEL[0].y);
  for (let i = 1; i < CHANNEL.length; i += 1) {
    ctx.lineTo(CHANNEL[i].x, CHANNEL[i].y);
  }
}

/**
 * The channel: a continuous plate along the polyline, wide enough to carry a
 * core, with the inlet and the intake marked so the direction of travel reads.
 *
 * Stroked rather than tiled leg by leg, so the corners miter cleanly and the
 * produced tile — which is seamless on all four sides — carries across a turn.
 */
function drawChannel(ctx: CanvasRenderingContext2D, assets: Assets): void {
  const plate = assets.channelPlate;
  if (plate !== null && patternSource !== plate) {
    platePattern = ctx.createPattern(plate, "repeat");
    patternSource = plate;
  }

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  tracePolyline(ctx);
  ctx.lineWidth = PLATE_WIDTH + 8;
  ctx.strokeStyle = COLOR.outline;
  ctx.stroke();

  // A lit rim just proud of the plate: the one thing that makes the channel's
  // path read at a glance against a hall this dark.
  tracePolyline(ctx);
  ctx.lineWidth = PLATE_WIDTH + 4;
  ctx.strokeStyle = COLOR.plateBevel;
  ctx.stroke();

  tracePolyline(ctx);
  ctx.lineWidth = PLATE_WIDTH;
  ctx.strokeStyle = platePattern ?? COLOR.plateBase;
  ctx.stroke();

  // A breath of lamp light over the plate, so the channel's run reads against a
  // hall this dark without the plate ever out-shining a core standing on it.
  tracePolyline(ctx);
  ctx.lineWidth = PLATE_WIDTH;
  ctx.strokeStyle = fade(COLOR.condensation, 0.14);
  ctx.stroke();

  // A hairline down the middle: the rail the train rides, and the one cue that
  // says which way is along the channel rather than across it.
  tracePolyline(ctx);
  ctx.lineWidth = 1;
  ctx.strokeStyle = fade(COLOR.condensation, 0.35);
  ctx.stroke();
  ctx.restore();

  drawInlet(ctx);
}

/** The inlet: the mouth cores arrive from, marked with the way they travel. */
function drawInlet(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(INLET.x, INLET.y);
  ctx.fillStyle = COLOR.plateBevel;
  ctx.strokeStyle = COLOR.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = COLOR.plateDeep;
  ctx.beginPath();
  ctx.arc(0, 0, 15, 0, Math.PI * 2);
  ctx.fill();

  // Three chevrons pointing the way the train leaves the inlet.
  ctx.strokeStyle = COLOR.lamp;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i += 1) {
    const x = -6 + i * 7;
    ctx.beginPath();
    ctx.moveTo(x, -6);
    ctx.lineTo(x + 5, 0);
    ctx.lineTo(x, 6);
    ctx.stroke();
  }
  ctx.restore();

  text(ctx, "INLET", INLET.x, INLET.y + 42, {
    size: 9,
    align: "center",
    color: COLOR.condensation,
    tracking: 3,
  });
}

/** The intake: the produced maw, the heaviest thing on the field. */
function drawIntake(ctx: CanvasRenderingContext2D, assets: Assets): void {
  if (!drawSprite(ctx, assets.intakeMaw, INTAKE.x, INTAKE.y, 64, 64)) {
    ctx.save();
    ctx.fillStyle = COLOR.ember;
    ctx.strokeStyle = COLOR.hazard;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(INTAKE.x, INTAKE.y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  text(ctx, "INTAKE", INTAKE.x, INTAKE.y + 48, {
    size: 9,
    align: "center",
    color: fade(COLOR.alarmLit, 0.9),
    tracking: 3,
  });
}

/** Every core on the channel, at the point its arc position gives. */
function drawTrain(
  ctx: CanvasRenderingContext2D,
  state: View,
  assets: Assets,
): void {
  for (let i = state.cores.length - 1; i >= 0; i -= 1) {
    const core = state.cores[i];
    const point = pointAt(core.s);

    // A soft halo in the charge's own color, under the produced sprite: the hall
    // is dark, and the cores are the one thing in it that carries its own light.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const glow = ctx.createRadialGradient(
      point.x,
      point.y,
      0,
      point.x,
      point.y,
      CORE_RADIUS + 4,
    );
    glow.addColorStop(0, fade(CHARGE_COLOR[core.charge], 0.42));
    glow.addColorStop(0.7, fade(CHARGE_COLOR[core.charge], 0.22));
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(point.x, point.y, CORE_RADIUS + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawCore(ctx, assets, core.charge, point.x, point.y, CORE_RADIUS * 2);

    if (core.mark !== null) {
      drawSprite(
        ctx,
        assets.marks[core.mark],
        point.x + 10,
        point.y - 8,
        16,
        16,
      );
    }
  }
}

/** The injector: the produced base, and the barrel turned to the aim. */
function drawInjector(
  ctx: CanvasRenderingContext2D,
  state: View,
  assets: Assets,
): void {
  const barrel =
    recoilFrame(assets, state.fireCooldown) ?? assets.injectorBarrel;

  ctx.save();
  ctx.translate(INJECTOR_X, INJECTOR_Y);
  ctx.rotate((state.aim * Math.PI) / 180);
  if (barrel !== null) {
    // Authored pointing toward +x, with its center line halfway down the canvas.
    ctx.drawImage(
      barrel,
      0,
      0,
      barrel.width,
      barrel.height,
      -6,
      -barrel.height / 2,
      barrel.width,
      barrel.height,
    );
  } else {
    ctx.fillStyle = COLOR.steel;
    ctx.fillRect(-6, -5, 44, 10);
  }
  ctx.restore();

  if (!drawSprite(ctx, assets.injectorBase, INJECTOR_X, INJECTOR_Y, 44, 44)) {
    ctx.save();
    ctx.fillStyle = COLOR.plateLit;
    ctx.strokeStyle = COLOR.outline;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(INJECTOR_X, INJECTOR_Y, INJECTOR_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // The charge the injector is about to release, seated in its hub.
  if (state.loaded !== null) {
    drawCore(ctx, assets, state.loaded, INJECTOR_X, INJECTOR_Y, 20);
  }
}

/** Every projectile between the injector and what it meets. */
function drawProjectiles(
  ctx: CanvasRenderingContext2D,
  state: View,
  assets: Assets,
): void {
  for (const projectile of state.projectiles) {
    const radians = (projectile.angle * Math.PI) / 180;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = fade(CHARGE_COLOR[projectile.charge], 0.35);
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(projectile.x, projectile.y);
    ctx.lineTo(
      projectile.x - Math.cos(radians) * 26,
      projectile.y - Math.sin(radians) * 26,
    );
    ctx.stroke();
    ctx.restore();

    drawCore(
      ctx,
      assets,
      projectile.charge,
      projectile.x,
      projectile.y,
      PROJECTILE_RADIUS * 2,
    );
  }
}

/**
 * Where the sightline ray ends: the near edge of the first core it crosses, or
 * the field edge when it crosses none.
 *
 * Exported because it is the whole of the machinery's visible effect, and a pure
 * function of the state.
 */
export function sightlineEnd(state: View): { x: number; y: number } {
  const radians = (state.aim * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);

  let best = fieldExit(dx, dy);
  for (const core of state.cores) {
    const point = pointAt(core.s);
    const t = rayCircle(dx, dy, point.x - INJECTOR_X, point.y - INJECTOR_Y);
    if (t !== null && t < best) best = t;
  }
  return { x: INJECTOR_X + dx * best, y: INJECTOR_Y + dy * best };
}

/** The distance along the ray at which it first crosses a core's edge. */
function rayCircle(
  dx: number,
  dy: number,
  cx: number,
  cy: number,
): number | null {
  const along = cx * dx + cy * dy;
  const across = cx * dy - cy * dx;
  const half = CORE_RADIUS * CORE_RADIUS - across * across;
  if (half < 0) return null;
  const t = along - Math.sqrt(half);
  return t > 0 ? t : null;
}

/** The distance along the ray at which it leaves the field. */
function fieldExit(dx: number, dy: number): number {
  let best = Math.hypot(FIELD_W, FIELD_H);
  if (dx > 0) best = Math.min(best, (FIELD_W - INJECTOR_X) / dx);
  if (dx < 0) best = Math.min(best, -INJECTOR_X / dx);
  if (dy > 0) best = Math.min(best, (FIELD_H - INJECTOR_Y) / dy);
  if (dy < 0) best = Math.min(best, -INJECTOR_Y / dy);
  return best;
}

/** The radius of the bead that caps the sightline ray, in field units. */
const SIGHTLINE_CAP = 3;

/** The aim ray sightline draws, recomputed every frame so it follows the aim. */
function drawSightline(ctx: CanvasRenderingContext2D, state: View): void {
  const end = sightlineEnd(state);
  const radians = (state.aim * Math.PI) / 180;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = fade(COLOR.lampLit, 0.55);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(INJECTOR_X, INJECTOR_Y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  // The bead that caps the ray sits one radius BEHIND the end, not on it: the ray
  // ends where it first crosses a core's edge, so nothing drawn for it may reach
  // past that point onto the core.
  ctx.fillStyle = fade(COLOR.lampLit, 0.8);
  ctx.beginPath();
  ctx.arc(
    end.x - Math.cos(radians) * SIGHTLINE_CAP,
    end.y - Math.sin(radians) * SIGHTLINE_CAP,
    SIGHTLINE_CAP,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}
