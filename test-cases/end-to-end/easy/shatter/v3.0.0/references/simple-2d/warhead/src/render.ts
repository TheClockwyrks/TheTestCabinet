// Shatter — the drawing (`specs/overview.md`, `specs/ui.md`).
//
// `render` is handed the state `update` returned, read-only, and a context that
// arrives cleared and already carrying the logical transform, so everything here
// is in 1280x720 field units and nothing reads the canvas element.
//
// THE WRAP IS DRAWN, NOT JUST SIMULATED. A body whose shape crosses a seam shows
// at both edges at once (`specs/field.md`), so every body goes through
// `wrapped`, which repeats the drawing at each of the nine field offsets whose
// bounding box still touches the field. A bullet's tail goes through the same
// helper, which is what makes it follow its bullet round the edge instead of
// smearing back across the field.
//
// NOTHING HERE IS FIXED BY THE SPECIFICATION except what a player must be able
// to read at a glance: the legibility table in `specs/overview.md`, the dark
// field, the HUD's contents, and each screen's copy. The palette, the type and
// the shapes are this build's own.

import {
  BULLET_R,
  CORE_R,
  FIELD_H,
  FIELD_W,
  GAMEOVER_ITEMS,
  HALO_R,
  HIT_FLASH_TIME,
  PAUSE_ITEMS,
  ROCK_HEALTH,
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_R,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  TORPEDO_R,
} from "./constants";
import { hashed } from "./rng";
import { BACKGROUND, COLOR, STARFIELD, font } from "./theme";
import type {
  BulletState,
  RockState,
  SaucerState,
  ShatterState,
  ShipState,
  TorpedoState,
  TrailState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

type Ctx = CanvasRenderingContext2D;
type State = DeepReadonly<ShatterState>;

/** How many faint stars sit behind the field. Decoration alone. */
const STAR_COUNT = 90;

/** Draw `paint` at every wrapped image of `(x, y)` that touches the field. */
function wrapped(
  x: number,
  y: number,
  reach: number,
  paint: (cx: number, cy: number) => void,
): void {
  for (const ox of [-FIELD_W, 0, FIELD_W]) {
    for (const oy of [-FIELD_H, 0, FIELD_H]) {
      const cx = x + ox;
      const cy = y + oy;
      if (cx + reach < 0 || cx - reach > FIELD_W) continue;
      if (cy + reach < 0 || cy - reach > FIELD_H) continue;
      paint(cx, cy);
    }
  }
}

/** A colour between two `#rrggbb` values. */
function mix(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - k) + ((b >> shift) & 0xff) * k);
  const r = channel(16);
  const g = channel(8);
  const bl = channel(0);
  return `rgb(${String(r)}, ${String(g)}, ${String(bl)})`;
}

/** The field itself: flat, deep, and dark, with a scatter of far stars. */
function drawField(ctx: Ctx): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  ctx.fillStyle = STARFIELD;
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const x = hashed(i * 2 + 1) * FIELD_W;
    const y = hashed(i * 2 + 2) * FIELD_H;
    const size = 1 + Math.floor(hashed(i + 9001) * 2);
    ctx.fillRect(Math.floor(x), Math.floor(y), size, size);
  }
}

/**
 * The star: a bright solid core, and a halo fading outward into the field.
 *
 * `specs/field.md` fixes both bounds the halo answers to — it falls as the
 * distance grows, and nothing of the star is drawn beyond `1.5 x HALO_R`.
 */
function drawStar(ctx: Ctx): void {
  const reach = HALO_R * 1.5;
  const halo = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    CORE_R,
    STAR_X,
    STAR_Y,
    reach,
  );
  halo.addColorStop(0, "rgba(255, 176, 82, 0.62)");
  halo.addColorStop(0.28, "rgba(255, 140, 60, 0.30)");
  halo.addColorStop(0.6, "rgba(255, 110, 50, 0.11)");
  halo.addColorStop(1, "rgba(255, 100, 45, 0)");

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
  core.addColorStop(0, COLOR.starCore);
  core.addColorStop(1, COLOR.starInner);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, CORE_R, 0, Math.PI * 2);
  ctx.fill();
}

/** One rock's outline, as a fixed irregular shape its id decides. */
function rockPath(
  ctx: Ctx,
  rock: DeepReadonly<RockState>,
  radius: number,
): void {
  const points = 9;
  ctx.beginPath();
  for (let i = 0; i < points; i += 1) {
    const a = rock.spin + (i / points) * Math.PI * 2;
    const r = radius * (0.87 + 0.13 * hashed(rock.id * 31 + i));
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawRock(ctx: Ctx, rock: DeepReadonly<RockState>): void {
  const radius = ROCK_RADIUS[rock.size];
  const full = ROCK_HEALTH[rock.size];
  const wholeness = full <= 1 ? 1 : (rock.health - 1) / (full - 1);
  const body =
    rock.flash > 0
      ? mix(COLOR.rockFlash, COLOR.rockWhole, 1 - rock.flash / HIT_FLASH_TIME)
      : mix(COLOR.rockRuined, COLOR.rockWhole, wholeness);

  wrapped(rock.x, rock.y, radius + 2, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    rockPath(ctx, rock, radius);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLOR.rockEdge;
    ctx.stroke();

    // The damage a rock carries reads as fissures opening across it.
    const cracks = full - rock.health;
    if (cracks > 0) {
      ctx.strokeStyle = "rgba(12, 8, 8, 0.75)";
      ctx.lineWidth = Math.max(1.5, radius * 0.07);
      for (let i = 0; i < cracks; i += 1) {
        const a = rock.spin + hashed(rock.id * 7 + i) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * radius * 0.9, Math.sin(a) * radius * 0.9);
        ctx.lineTo(
          Math.cos(a + 2.3) * radius * 0.45,
          Math.sin(a + 2.3) * radius * 0.45,
        );
        ctx.lineTo(
          Math.cos(a + 3.6) * radius * 0.85,
          Math.sin(a + 3.6) * radius * 0.85,
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  });
}

/** A bullet's tail: one continuous streak, tapering and fading behind it. */
function drawTrail(
  ctx: Ctx,
  bullet: DeepReadonly<BulletState>,
  trail: DeepReadonly<TrailState>,
): void {
  const points = trail.points;
  if (points.length < 1) return;

  let reach = 0;
  for (const point of points) {
    reach = Math.max(reach, Math.hypot(point.dx, point.dy));
  }

  wrapped(bullet.x, bullet.y, reach + 4, (cx, cy) => {
    ctx.lineCap = "round";
    let prevX = cx;
    let prevY = cy;
    for (let i = points.length - 1; i >= 0; i -= 1) {
      const point = points[i];
      const age = (points.length - i) / points.length;
      const nextX = cx + point.dx;
      const nextY = cy + point.dy;
      ctx.strokeStyle = COLOR.bulletTrail;
      ctx.globalAlpha = 0.75 * (1 - age);
      ctx.lineWidth = Math.max(0.4, 2 * BULLET_R * (1 - age));
      ctx.beginPath();
      ctx.moveTo(prevX, prevY);
      ctx.lineTo(nextX, nextY);
      ctx.stroke();
      prevX = nextX;
      prevY = nextY;
    }
    ctx.globalAlpha = 1;
  });
}

function drawRound(
  ctx: Ctx,
  bullet: DeepReadonly<BulletState>,
  radius: number,
  color: string,
): void {
  wrapped(bullet.x, bullet.y, radius + 5, (cx, cy) => {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** The heavy weapon: longer, blunter and hotter than a round. */
function drawTorpedo(
  ctx: Ctx,
  torpedo: DeepReadonly<TorpedoState>,
  simTime: number,
): void {
  wrapped(torpedo.x, torpedo.y, 22, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(torpedo.heading);

    const flare = 8 + Math.sin(simTime * 70) * 3;
    ctx.fillStyle = COLOR.torpedoFlame;
    ctx.beginPath();
    ctx.moveTo(-TORPEDO_R - 1, TORPEDO_R * 0.6);
    ctx.lineTo(-TORPEDO_R - 1 - flare, 0);
    ctx.lineTo(-TORPEDO_R - 1, -TORPEDO_R * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = COLOR.torpedo;
    ctx.beginPath();
    ctx.moveTo(TORPEDO_R * 1.9, 0);
    ctx.lineTo(TORPEDO_R * 0.4, TORPEDO_R);
    ctx.lineTo(-TORPEDO_R, TORPEDO_R);
    ctx.lineTo(-TORPEDO_R, -TORPEDO_R);
    ctx.lineTo(TORPEDO_R * 0.4, -TORPEDO_R);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = COLOR.torpedoEdge;
    ctx.stroke();

    ctx.fillStyle = COLOR.torpedoEdge;
    ctx.fillRect(-TORPEDO_R, -TORPEDO_R * 1.8, 3, TORPEDO_R * 3.6);
    ctx.restore();
  });
}

function drawSaucer(ctx: Ctx, saucer: DeepReadonly<SaucerState>): void {
  wrapped(saucer.x, saucer.y, SAUCER_R + 4, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.fillStyle = COLOR.saucerDome;
    ctx.beginPath();
    ctx.ellipse(0, -3, SAUCER_R * 0.5, SAUCER_R * 0.5, 0, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = COLOR.saucer;
    ctx.beginPath();
    ctx.ellipse(0, 0, SAUCER_R, SAUCER_R * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = COLOR.saucerEdge;
    ctx.stroke();

    ctx.fillStyle = COLOR.saucerEdge;
    for (const lamp of [-0.62, 0, 0.62]) {
      ctx.beginPath();
      ctx.arc(SAUCER_R * lamp, SAUCER_R * 0.18, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

/** The ship, its flame while it burns, and the ring its grace wears. */
function drawShip(
  ctx: Ctx,
  ship: DeepReadonly<ShipState>,
  simTime: number,
): void {
  const blinking = ship.invuln > 0 && Math.floor(ship.invuln * 8) % 2 === 1;

  wrapped(ship.x, ship.y, SHIP_R + 26, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ship.angle);
    ctx.globalAlpha = blinking ? 0.3 : 1;

    if (ship.thrusting) {
      const flare = 12 + Math.sin(simTime * 90) * 5;
      ctx.fillStyle = COLOR.flameCold;
      ctx.beginPath();
      ctx.moveTo(-13, 8);
      ctx.lineTo(-13 - flare, 0);
      ctx.lineTo(-13, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLOR.flameHot;
      ctx.beginPath();
      ctx.moveTo(-13, 4);
      ctx.lineTo(-13 - flare * 0.55, 0);
      ctx.lineTo(-13, -4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-14, 13);
    ctx.lineTo(-8, 0);
    ctx.lineTo(-14, -13);
    ctx.closePath();
    ctx.fillStyle = COLOR.ship;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = COLOR.shipEdge;
    ctx.stroke();
    ctx.restore();

    // The grace ring sits OUTSIDE the ship's own radius, so the ship itself is
    // drawn exactly as it always is on the half of the blink it is lit for.
    if (ship.invuln > 0) {
      ctx.save();
      ctx.globalAlpha = blinking ? 0.25 : 0.85;
      ctx.strokeStyle = COLOR.shipEdge;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, SHIP_R + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  });
}

/** One small ship glyph, as the HUD draws a ship held in reserve. */
function drawShipGlyph(ctx: Ctx, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(-14, 13);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-14, -13);
  ctx.closePath();
  ctx.fillStyle = COLOR.ship;
  ctx.fill();
  ctx.restore();
}

/**
 * The HUD: the score, one glyph per ship in reserve, and the torpedo charge.
 *
 * All of it sits in the upper left, clear of the field's centre, as
 * `specs/ui.md` requires.
 */
function drawHud(ctx: Ctx, state: State): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(14, "600");
  ctx.fillText("SCORE", 24, 20);

  ctx.fillStyle = COLOR.text;
  ctx.font = font(36, "700");
  ctx.fillText(String(state.score), 24, 38);

  const reserve = Math.max(0, state.lives - 1);
  for (let i = 0; i < reserve; i += 1) {
    drawShipGlyph(ctx, 32 + i * 24, 92, 0.42);
  }

  const ready = state.torpedoCharge >= 1;
  ctx.save();
  ctx.globalAlpha = ready ? 1 : 0.4;
  ctx.save();
  ctx.translate(32, 124);
  ctx.rotate(-Math.PI / 2);
  ctx.scale(0.9, 0.9);
  ctx.fillStyle = COLOR.torpedo;
  ctx.beginPath();
  ctx.moveTo(TORPEDO_R * 1.9, 0);
  ctx.lineTo(TORPEDO_R * 0.4, TORPEDO_R);
  ctx.lineTo(-TORPEDO_R, TORPEDO_R);
  ctx.lineTo(-TORPEDO_R, -TORPEDO_R);
  ctx.lineTo(TORPEDO_R * 0.4, -TORPEDO_R);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = "rgba(233, 242, 255, 0.18)";
  ctx.fillRect(48, 118, 96, 8);
  ctx.fillStyle = ready ? COLOR.highlight : COLOR.torpedo;
  ctx.fillRect(48, 118, 96 * Math.max(0, Math.min(1, state.torpedoCharge)), 8);
}

/** One vertical menu, with the highlighted entry drawn apart from the rest. */
function drawMenu(
  ctx: Ctx,
  entries: readonly string[],
  selected: number,
  top: number,
  step: number,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  entries.forEach((entry, index) => {
    const y = top + index * step;
    const active = index === selected;
    ctx.font = font(active ? 32 : 28, active ? "700" : "500");
    ctx.fillStyle = active ? COLOR.highlight : COLOR.textDim;
    ctx.fillText(entry, FIELD_W / 2, y);
    if (active) {
      ctx.fillText("▸", FIELD_W / 2 - 170, y);
      ctx.fillText("◂", FIELD_W / 2 + 170, y);
    }
  });
}

/** A dimming wash over the field, so a screen's text always reads against it. */
function drawScrim(ctx: Ctx): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
}

function drawTitle(ctx: Ctx, state: State): void {
  drawScrim(ctx);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = COLOR.text;
  ctx.font = font(88, "800");
  ctx.fillText(TITLE_TEXT, FIELD_W / 2, 200);

  ctx.fillStyle = COLOR.highlight;
  ctx.font = font(24, "600");
  ctx.fillText(TAGLINE_TEXT, FIELD_W / 2, 268);

  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, 400, 56);
}

const HOWTO_LINES: readonly string[] = [
  "Shoot every rock down, through every fragment it leaves, to clear a wave.",
  "The star at the centre pulls bullets and rocks but never your ship, so a shot",
  "bends as it crosses the middle and can be curved around onto a rock behind it.",
  "A rock the star swallows is not gone: it comes straight back in from an edge.",
  "A saucer wanders in to hunt you, and it can be shot down for a good score.",
  "Larger rocks are armored and take several hits, showing their damage as they take them.",
  "Your torpedo is one guided munition on a ten-second recharge. It locks onto the",
  "nearest body in a narrow cone ahead, flies dead straight through the well, and",
  "destroys any rock outright.",
];

const HOWTO_KEYS: readonly (readonly [string, string])[] = [
  ["ARROWS", "turn left and right, and thrust"],
  ["WASD", "the same controls, on the left hand"],
  ["SPACE", "fire the gun"],
  ["F", "launch the torpedo"],
  ["ENTER", "confirm a menu choice"],
  ["ESC", "pause a game, and step back from a screen"],
  ["P", "pause a game"],
  ["M", "mute and unmute the sound"],
];

function drawHowTo(ctx: Ctx): void {
  drawScrim(ctx);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(44, "800");
  ctx.fillText("HOW TO PLAY", FIELD_W / 2, 70);

  ctx.textAlign = "left";
  ctx.font = font(17, "500");
  ctx.fillStyle = COLOR.textDim;
  HOWTO_LINES.forEach((line, index) => {
    ctx.fillText(line, 130, 130 + index * 26);
  });

  HOWTO_KEYS.forEach(([key, what], index) => {
    const y = 400 + index * 30;
    ctx.font = font(19, "700");
    ctx.fillStyle = COLOR.highlight;
    ctx.fillText(key, 240, y);
    ctx.font = font(17, "500");
    ctx.fillStyle = COLOR.textDim;
    ctx.fillText(what, 400, y);
  });

  ctx.textAlign = "center";
  ctx.font = font(16, "600");
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText("ESC returns to the title", FIELD_W / 2, 668);
}

function drawPaused(ctx: Ctx, state: State): void {
  drawScrim(ctx);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLOR.text;
  ctx.font = font(56, "800");
  ctx.fillText("PAUSED", FIELD_W / 2, 210);
  drawMenu(ctx, PAUSE_ITEMS, state.menuIndex, 350, 56);
}

function drawGameOver(ctx: Ctx, state: State): void {
  drawScrim(ctx);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = COLOR.text;
  ctx.font = font(64, "800");
  ctx.fillText("GAME OVER", FIELD_W / 2, 160);

  ctx.font = font(18, "600");
  ctx.fillStyle = COLOR.textDim;
  ctx.fillText("SCORE", FIELD_W / 2 - 160, 250);
  ctx.fillText("WAVE", FIELD_W / 2 + 160, 250);

  ctx.font = font(40, "700");
  ctx.fillStyle = COLOR.highlight;
  ctx.fillText(String(state.score), FIELD_W / 2 - 160, 292);
  ctx.fillText(String(state.wave), FIELD_W / 2 + 160, 292);

  drawMenu(ctx, GAMEOVER_ITEMS, state.menuIndex, 420, 56);
}

/** The `WAVE N` banner, over the middle of the field while it runs. */
function drawBanner(ctx: Ctx, state: State): void {
  if (state.waveBanner <= 0) return;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = font(58, "800");
  ctx.fillStyle = COLOR.text;
  ctx.fillText("WAVE", FIELD_W / 2 + 6, 300);
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR.highlight;
  ctx.fillText(String(state.wave), FIELD_W / 2 + 22, 300);
}

/** The announcement an extra ship is granted with. */
function drawExtraShip(ctx: Ctx, state: State): void {
  if (state.extraLifeFlash <= 0) return;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(34, "800");
  ctx.fillStyle = COLOR.highlight;
  ctx.fillText("EXTRA SHIP", FIELD_W / 2, 190);
}

/** Draw the whole game, whichever screen it is on. */
export function renderGame(
  state: State,
  ctx: Ctx,
  _width: number,
  _height: number,
): void {
  drawField(ctx);
  drawStar(ctx);

  for (const rock of state.rocks) drawRock(ctx, rock);

  for (const bullet of state.bullets) {
    const trail = state.trails.find((entry) => entry.id === bullet.id);
    if (trail !== undefined) drawTrail(ctx, bullet, trail);
  }
  for (const bullet of state.bullets) {
    drawRound(ctx, bullet, BULLET_R, COLOR.bullet);
  }
  for (const torpedo of state.torpedoes) {
    drawTorpedo(ctx, torpedo, state.simTime);
  }
  for (const bullet of state.enemyBullets) {
    drawRound(ctx, bullet, SAUCER_BULLET_R, COLOR.enemyBullet);
  }
  if (state.saucer !== null) drawSaucer(ctx, state.saucer);

  if (state.screen === "playing" || state.screen === "paused") {
    drawShip(ctx, state.ship, state.simTime);
  }

  if (state.screen === "playing" || state.screen === "paused") {
    drawHud(ctx, state);
    drawBanner(ctx, state);
    drawExtraShip(ctx, state);
  }

  switch (state.screen) {
    case "title":
      drawTitle(ctx, state);
      return;
    case "howto":
      drawHowTo(ctx);
      return;
    case "paused":
      drawPaused(ctx, state);
      return;
    case "gameover":
      drawGameOver(ctx, state);
      return;
    case "playing":
      return;
  }
}
