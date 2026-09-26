// Shatter — the picture, drawn from the state and writing nothing back.
//
// Rendering belongs to the engine's pipeline: it collects every enabled,
// visible render component, orders it by layer and calls each in turn. Each
// function here is one of those layers, and each is a PURE READ of the world's
// `ShatterState` (`specs/state.md`, The contract).
//
// The wrap is what shapes this module. `specs/field.md` says a body whose shape
// crosses a seam is drawn on both sides at once, so every body goes through
// `drawWrapped`, which paints it at its own position and again at each field
// offset that lands part of it back inside the field. The alternative — a
// render component per copy at a fixed offset — does not work here: a
// component's offset is composed with its actor's transform and so ROTATES with
// it, and Shatter's rocks spin and its ship turns, so the copies would orbit
// the body instead of tiling the field.

import {
  CORE_R,
  FIELD_H,
  FIELD_W,
  HALO_R,
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_R,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TAGLINE_TEXT,
  TICK_DT,
  TITLE_TEXT,
  TRAIL_TICKS,
  BULLET_R,
} from "./constants";
import type { RockState, Screen, ShatterState } from "./game";
import { MENU_MARK_X, MENU_STEP, MENU_TEXT_X, menuLayout } from "./menus";
import { COLOR, FONT } from "./theme";

/** The eight neighbouring images of the field, plus the field itself. */
const OFFSETS: readonly [number, number][] = [
  [0, 0],
  [-FIELD_W, 0],
  [FIELD_W, 0],
  [0, -FIELD_H],
  [0, FIELD_H],
  [-FIELD_W, -FIELD_H],
  [-FIELD_W, FIELD_H],
  [FIELD_W, -FIELD_H],
  [FIELD_W, FIELD_H],
];

/**
 * Paint a body at its own position and at every wrapped image of it that puts
 * part of the body back inside the field, so a shape straddling a seam shows at
 * both edges at once.
 *
 * `reach` is how far the drawing extends from `(x, y)`, which is what decides
 * whether an image is worth painting at all.
 */
export function drawWrapped(
  x: number,
  y: number,
  reach: number,
  paint: (cx: number, cy: number) => void,
): void {
  for (const [ox, oy] of OFFSETS) {
    const cx = x + ox;
    const cy = y + oy;
    if (cx + reach < 0 || cx - reach > FIELD_W) continue;
    if (cy + reach < 0 || cy - reach > FIELD_H) continue;
    paint(cx, cy);
  }
}

/** Whether the screen shows the live field behind whatever is over it. */
function showsField(state: ShatterState): boolean {
  return (
    state.screen === "playing" ||
    state.screen === "paused" ||
    state.screen === "gameover"
  );
}

// ---- The ground -----------------------------------------------------------

/** A scatter of far stars, placed by index alone so nothing is stored. */
function dustAt(index: number): { x: number; y: number; r: number } {
  let h = Math.imul(index + 1, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  const a = h % 100003;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  const b = h % 100003;
  return {
    x: (a / 100003) * FIELD_W,
    y: (b / 100003) * FIELD_H,
    r: 0.7 + ((h >>> 7) % 100) / 140,
  };
}

/** Deep space: the ground the whole field is read against. */
export function renderSpace(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = COLOR.space;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  ctx.fillStyle = COLOR.dust;
  for (let index = 0; index < 120; index += 1) {
    const dust = dustAt(index);
    ctx.beginPath();
    ctx.arc(dust.x, dust.y, dust.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The star: a bright core, and a halo that falls away outward from the core's
 * edge and is drawn nowhere beyond `1.5 x HALO_R`.
 */
export function renderStar(ctx: CanvasRenderingContext2D): void {
  const reach = HALO_R * 1.5;

  ctx.save();
  const halo = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    CORE_R,
    STAR_X,
    STAR_Y,
    reach,
  );
  halo.addColorStop(0, `rgba(${COLOR.halo}, 0.55)`);
  halo.addColorStop(0.35, `rgba(${COLOR.halo}, 0.22)`);
  halo.addColorStop(1, `rgba(${COLOR.halo}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, reach, 0, Math.PI * 2);
  ctx.fill();

  const core = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    0,
    STAR_X,
    STAR_Y,
    CORE_R,
  );
  core.addColorStop(0, COLOR.core);
  core.addColorStop(0.6, COLOR.core);
  core.addColorStop(1, COLOR.coreRim);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, CORE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ---- The bodies -----------------------------------------------------------

/** A rock's drawn outline: a jagged ring, fixed for the life of the rock. */
function rockOutline(id: number, radius: number): [number, number][] {
  const points: [number, number][] = [];
  const corners = 9;
  let h = Math.imul(id + 1, 0x9e3779b1) >>> 0;
  for (let index = 0; index < corners; index += 1) {
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
    const reach = radius * (0.8 + ((h % 1000) / 1000) * 0.22);
    const angle = (index / corners) * Math.PI * 2;
    points.push([Math.cos(angle) * reach, Math.sin(angle) * reach]);
  }
  return points;
}

function paintRock(
  ctx: CanvasRenderingContext2D,
  rock: RockState,
  cx: number,
  cy: number,
): void {
  const radius = ROCK_RADIUS[rock.size];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rock.spin);
  ctx.beginPath();
  rockOutline(rock.id, radius).forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = COLOR.rock;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, radius * 0.07);
  ctx.strokeStyle = COLOR.rockEdge;
  ctx.stroke();
  ctx.restore();
}

/** Every rock on the field, each drawn on both sides of a seam it straddles. */
export function renderRocks(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!showsField(state)) return;
  for (const rock of state.rocks) {
    const radius = ROCK_RADIUS[rock.size];
    drawWrapped(rock.x, rock.y, radius + 2, (cx, cy) =>
      paintRock(ctx, rock, cx, cy),
    );
  }
}

/**
 * Every one of the ship's rounds, each with the fading tail that makes the way
 * the star bends a shot read at a glance.
 *
 * The tail spans the last `TRAIL_TICKS` of the round's travel, so its drawn
 * length is proportional to the round's current speed, and it is drawn through
 * the same wrapped painter as the round itself, so it follows the round to the
 * far edge rather than smearing across the field.
 */
export function renderBullets(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!showsField(state)) return;

  for (const bullet of state.bullets) {
    const speed = Math.hypot(bullet.vx, bullet.vy);
    const length = speed * TRAIL_TICKS * TICK_DT;
    const ux = speed === 0 ? 0 : -bullet.vx / speed;
    const uy = speed === 0 ? 0 : -bullet.vy / speed;

    drawWrapped(bullet.x, bullet.y, length + BULLET_R + 2, (cx, cy) => {
      if (length > 1) {
        const tx = cx + ux * length;
        const ty = cy + uy * length;
        const tail = ctx.createLinearGradient(cx, cy, tx, ty);
        tail.addColorStop(0, "rgba(255, 233, 168, 0.85)");
        tail.addColorStop(1, "rgba(255, 233, 168, 0)");
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx - uy * BULLET_R, cy + ux * BULLET_R);
        ctx.lineTo(cx + uy * BULLET_R, cy - ux * BULLET_R);
        ctx.lineTo(tx, ty);
        ctx.closePath();
        ctx.fillStyle = tail;
        ctx.fill();
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, BULLET_R, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.bullet;
      ctx.fill();
    });
  }
}

/** The ship: a triangle along its facing, its flame, and its respawn grace. */
export function renderShip(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!showsField(state)) return;

  const ship = state.ship;
  // Inside the grace the hull alternates between its own colour and a dimmed
  // one, ten times a second, and settles the moment the grace ends.
  const dimmed = ship.invuln > 0 && Math.floor(ship.invuln * 10) % 2 === 0;
  const body = dimmed ? COLOR.shipGrace : COLOR.ship;

  drawWrapped(ship.x, ship.y, SHIP_R * 2.4, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ship.angle);

    if (ship.thrusting) {
      const flicker = 10 + ((state.simTime * 90) % 8);
      ctx.beginPath();
      ctx.moveTo(-14, 7);
      ctx.lineTo(-14 - flicker, 0);
      ctx.lineTo(-14, -7);
      ctx.closePath();
      ctx.fillStyle = COLOR.flame;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-14, 13);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-14, -13);
    ctx.closePath();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = dimmed ? COLOR.ship : COLOR.shipEdge;
    ctx.stroke();
    ctx.restore();
  });
}

/** The saucer while it is visiting, and every round it has in the air. */
export function renderSaucer(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!showsField(state)) return;

  const saucer = state.saucer;
  if (saucer !== null) {
    drawWrapped(saucer.x, saucer.y, SAUCER_R + 6, (cx, cy) => {
      ctx.save();
      ctx.translate(cx, cy);

      ctx.beginPath();
      ctx.ellipse(0, -4, SAUCER_R * 0.5, SAUCER_R * 0.45, 0, Math.PI, 0);
      ctx.fillStyle = COLOR.saucerDome;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, SAUCER_R, SAUCER_R * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.saucer;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLOR.saucerDome;
      ctx.stroke();
      ctx.restore();
    });
  }

  for (const bullet of state.enemyBullets) {
    drawWrapped(bullet.x, bullet.y, SAUCER_BULLET_R + 2, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, SAUCER_BULLET_R, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.enemyBullet;
      ctx.fill();
    });
  }
}

// ---- The readouts ---------------------------------------------------------

/** One small ship glyph, as the reserve row draws it. */
function paintGlyph(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(-8, 7);
  ctx.lineTo(-4, 0);
  ctx.lineTo(-8, -7);
  ctx.closePath();
  ctx.fillStyle = COLOR.ship;
  ctx.fill();
  ctx.restore();
}

/**
 * The HUD over live play, and the two notices that sit over the field: the
 * `WAVE N` banner, and the announcement of an awarded ship.
 *
 * Both readouts sit in the upper portion of the field, clear of its centre.
 */
export function renderHud(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  if (!showsField(state)) return;

  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = FONT.score;
  ctx.fillStyle = COLOR.text;
  ctx.fillText(String(state.score), 36, 28);

  for (let index = 0; index < Math.max(0, state.lives - 1); index += 1) {
    paintGlyph(ctx, 46 + index * 28, 96);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (state.waveBanner > 0) {
    ctx.font = FONT.banner;
    ctx.fillStyle = COLOR.banner;
    ctx.fillText(`WAVE ${state.wave}`, FIELD_W / 2, 240);
  }
  if (state.extraLifeNotice > 0) {
    ctx.font = FONT.notice;
    ctx.fillStyle = COLOR.highlight;
    ctx.fillText("EXTRA SHIP", FIELD_W / 2, 470);
  }
  ctx.restore();
}

/** One vertical menu: its entries stacked, with the highlighted one apart. */
function paintMenu(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  selected: number,
): void {
  const layout = menuLayout(screen);
  if (layout === null) return;
  ctx.save();
  ctx.font = FONT.menu;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  layout.entries.forEach((item, index) => {
    const y = layout.top + index * MENU_STEP;
    const on = index === selected;
    ctx.fillStyle = on ? COLOR.highlight : COLOR.textDim;
    ctx.fillText(item, MENU_TEXT_X, y);
    if (on) ctx.fillText("▸", MENU_MARK_X, y);
  });
  ctx.restore();
}

/** The dimming laid over the field so a screen's text reads against it. */
function paintScrim(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

/** The lines the how-to screen explains the game in. */
const HOWTO_LINES: readonly string[] = [
  "SHOOT EVERY ROCK DOWN THROUGH ITS FRAGMENTS TO CLEAR A WAVE.",
  "THE STAR PULLS BULLETS AND ROCKS BUT NEVER YOUR SHIP,",
  "SO A SHOT CAN BE BENT AROUND IT ONTO A ROCK ON ITS FAR SIDE.",
  "A ROCK THE STAR SWALLOWS COMES BACK FROM THE EDGE OF THE FIELD.",
  "A SAUCER WANDERS IN TO HUNT YOU. SHOOT IT DOWN FOR 200.",
];

/** The keys the how-to screen names, each written as a standalone word. */
const HOWTO_KEYS: readonly [string, string][] = [
  ["TURN AND THRUST", "ARROWS or WASD"],
  ["FIRE", "SPACE"],
  ["CONFIRM", "ENTER or SPACE"],
  ["PAUSE", "P or ESC"],
  ["BACK", "ESC"],
  ["MUTE", "M"],
];

/** Whichever of the five screens is up, drawn over everything beneath it. */
export function renderScreens(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  if (state.screen === "playing") return;
  paintScrim(ctx);

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  switch (state.screen) {
    case "title":
      ctx.font = FONT.title;
      ctx.fillStyle = COLOR.text;
      ctx.fillText(TITLE_TEXT, FIELD_W / 2, 190);
      ctx.font = FONT.tagline;
      ctx.fillStyle = COLOR.highlight;
      ctx.fillText(TAGLINE_TEXT, FIELD_W / 2, 268);
      paintMenu(ctx, "title", state.menuIndex);
      break;

    case "howto": {
      ctx.font = FONT.heading;
      ctx.fillStyle = COLOR.text;
      ctx.fillText("HOW TO PLAY", FIELD_W / 2, 80);

      ctx.font = FONT.body;
      ctx.fillStyle = COLOR.text;
      HOWTO_LINES.forEach((line, index) => {
        ctx.fillText(line, FIELD_W / 2, 150 + index * 34);
      });

      ctx.textAlign = "right";
      HOWTO_KEYS.forEach(([label], index) => {
        ctx.fillStyle = COLOR.textDim;
        ctx.fillText(label, 600, 360 + index * 38);
      });
      ctx.textAlign = "left";
      HOWTO_KEYS.forEach(([, keys], index) => {
        ctx.fillStyle = COLOR.highlight;
        ctx.fillText(keys, 660, 360 + index * 38);
      });

      ctx.textAlign = "center";
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText("ESC TO GO BACK", FIELD_W / 2, 640);
      break;
    }

    case "paused":
      ctx.font = FONT.heading;
      ctx.fillStyle = COLOR.text;
      ctx.fillText("PAUSED", FIELD_W / 2, 220);
      paintMenu(ctx, "paused", state.menuIndex);
      break;

    case "gameover":
      ctx.font = FONT.heading;
      ctx.fillStyle = COLOR.text;
      ctx.fillText("GAME OVER", FIELD_W / 2, 170);

      ctx.font = FONT.menu;
      ctx.textAlign = "right";
      ctx.fillStyle = COLOR.textDim;
      ctx.fillText("SCORE", 620, 262);
      ctx.fillText("WAVE", 620, 312);
      ctx.textAlign = "left";
      ctx.fillStyle = COLOR.text;
      ctx.fillText(String(state.score), 660, 262);
      ctx.fillText(String(state.wave), 660, 312);

      paintMenu(ctx, "gameover", state.menuIndex);
      break;
  }
  ctx.restore();
}
