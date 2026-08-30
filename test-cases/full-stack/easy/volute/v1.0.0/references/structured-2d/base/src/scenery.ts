// Volute — the hall's fixed furniture: the channel plate and the sightline.
//
// The channel is drawn as a continuous plate along the polyline
// `specs/channel.md` fixes, wide enough to carry a core, with the inlet and the
// intake each marked so the direction of travel reads at a glance. The produced
// tile is seamless on all four sides, so the plate is STROKED along the whole
// polyline rather than tiled leg by leg: the corners then miter cleanly and the
// tile carries across a turn.

import {
  Actor,
  DrawComponent,
  type DrawApi,
} from "@test-cabinet/structured-2d";
import { assets } from "./assets";
import { INLET, INTAKE, pointAt } from "./channel";
import {
  CHANNEL,
  CORE_RADIUS,
  FIELD_H,
  FIELD_W,
  INJECTOR_X,
  INJECTOR_Y,
} from "./constants";
import { text } from "./draw";
import { HallMode } from "./hall-mode";
import { radians } from "./math";
import { COLOR, LAYER, fade } from "./theme";

/** How wide the plate the channel is drawn as stands, in logical units. */
export const PLATE_WIDTH = 40;

/** The path the channel runs along, walked once. */
function tracePolyline(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(CHANNEL[0].x, CHANNEL[0].y);
  for (let i = 1; i < CHANNEL.length; i += 1) {
    ctx.lineTo(CHANNEL[i].x, CHANNEL[i].y);
  }
}

/** The plate, its lit rim, its rail, and the inlet the train arrives from. */
class PlateDraw extends DrawComponent {
  private pattern: CanvasPattern | null = null;
  private patternSource: ImageBitmap | null = null;

  constructor() {
    super();
    this.layer = LAYER.plate;
  }

  draw(api: DrawApi): void {
    const { ctx } = api;

    // Every produced sprite is pixel art at one unit per pixel, so the whole
    // picture is sampled nearest-neighbor and stays crisp at whatever the canvas
    // fit turned out to be. Set here, on the first thing the pipeline draws, and
    // deliberately left set for the components after it.
    ctx.imageSmoothingEnabled = false;
    if (api.mode !== "shaded") return;

    const plate = assets().channelPlate;
    if (this.pattern === null || this.patternSource !== plate) {
      this.pattern = ctx.createPattern(plate, "repeat");
      this.patternSource = plate;
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

    if (this.pattern !== null) {
      tracePolyline(ctx);
      ctx.lineWidth = PLATE_WIDTH;
      ctx.strokeStyle = this.pattern;
      ctx.stroke();
    }

    // A breath of lamp light over the plate, so the channel's run reads without
    // the plate ever out-shining a core standing on it.
    tracePolyline(ctx);
    ctx.lineWidth = PLATE_WIDTH;
    ctx.strokeStyle = fade(COLOR.condensation, 0.14);
    ctx.stroke();

    // A hairline down the middle: the rail the train rides.
    tracePolyline(ctx);
    ctx.lineWidth = 1;
    ctx.strokeStyle = fade(COLOR.condensation, 0.35);
    ctx.stroke();
    ctx.restore();

    drawInlet(ctx);
    text(ctx, "INTAKE", INTAKE.x, INTAKE.y + 48, {
      size: 9,
      align: "center",
      color: fade(COLOR.alarmLit, 0.9),
      tracking: 3,
    });
  }
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

/** The channel itself. */
export class ChannelPlate extends Actor {
  constructor() {
    super();
    this.attach(new PlateDraw());
    this.tickEnabled = false;
  }
}

/** The radius of the bead that caps the sightline ray, in field units. */
const SIGHTLINE_CAP = 3;

/**
 * Where the sightline ray ends: the near edge of the first core it crosses, or
 * the field edge when it crosses none.
 *
 * A pure function of the aim and the cores, so the machinery's whole visible
 * effect can be read without drawing it.
 */
export function sightlineEnd(
  aim: number,
  cores: readonly { s: number }[],
): { x: number; y: number } {
  const heading = radians(aim);
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);

  let best = fieldExit(dx, dy);
  for (const core of cores) {
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

/** The aim ray sightline draws, recomputed every frame so it follows the aim. */
class SightlineDraw extends DrawComponent {
  constructor() {
    super();
    this.layer = LAYER.sightline;
  }

  draw(api: DrawApi): void {
    if (api.mode !== "shaded") return;
    const mode = this.world.mode;
    if (!(mode instanceof HallMode)) return;
    const state = mode.state;
    if (state.machinery?.kind !== "sightline") return;

    const aim = mode.injector().aim;
    const end = sightlineEnd(aim, state.cores);
    const heading = radians(aim);
    const { ctx } = api;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = fade(COLOR.lampLit, 0.55);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(INJECTOR_X, INJECTOR_Y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    // The bead that caps the ray sits one radius BEHIND the end, not on it: the
    // ray ends where it first crosses a core's edge, so nothing drawn for it may
    // reach past that point onto the core.
    ctx.fillStyle = fade(COLOR.lampLit, 0.8);
    ctx.beginPath();
    ctx.arc(
      end.x - Math.cos(heading) * SIGHTLINE_CAP,
      end.y - Math.sin(heading) * SIGHTLINE_CAP,
      SIGHTLINE_CAP,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }
}

/** The ray sightline draws while it is the active machinery. */
export class Sightline extends Actor {
  constructor() {
    super();
    this.attach(new SightlineDraw());
    this.tickEnabled = false;
  }
}
