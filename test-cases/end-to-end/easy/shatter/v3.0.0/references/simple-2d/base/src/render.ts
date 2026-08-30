// Shatter — all canvas drawing, in logical 1280x720 coordinates.
//
// `render` is a pure read of the state it is handed: nothing here advances or
// stores anything, and the context arrives cleared and already carrying the
// logical transform, so no code below reads the canvas element's size.
//
// The look is this build's own (`src/theme.ts`). What it must deliver is what
// `specs/overview.md` fixes: a field dark enough to read as deep space, a ship
// apart from every other body with its facing legible at a glance, a star that
// reads as a well — a bright core inside a halo that fades outward and stops —
// rocks, saucer and rounds told apart, a tail behind every moving round, a
// flame while the ship burns, a grace window that reads as one, and a HUD clear
// of the field's centre.
//
// THE SEAM. Every body on a torus can straddle an edge, so each is drawn once
// per wrapped offset that brings any of it back onto the field. `drawWrapped`
// is that rule in one place, and every body goes through it.

import {
  BULLET_R,
  CORE_R,
  FIELD_H,
  FIELD_W,
  GAMEOVER_ITEMS,
  HALO_R,
  PAUSE_ITEMS,
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_R,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TAGLINE_TEXT,
  TICK_DT,
  TITLE_ITEMS,
  TITLE_TEXT,
  TRAIL_TICKS,
  type RockSize,
} from "./constants";
import { SEAM_OFFSETS } from "./field";
import { gravityAt } from "./gravity";
import { BLINK_PERIOD, COLOR, HUD, font, withAlpha } from "./theme";
import type {
  BulletState,
  RockState,
  SaucerState,
  ShatterState,
  ShipState,
} from "./game";
import type { DeepReadonly } from "ts-essentials";

type Ctx = CanvasRenderingContext2D;

/** Nothing of the star is drawn beyond this: `1.5 x HALO_R`. */
const STAR_REACH = HALO_R * 1.5;

/**
 * Draw a body once per wrapped image of it that touches the field.
 *
 * `reach` is how far from the body's centre anything is drawn, so a body whose
 * drawing crosses a seam appears on both sides at once and a body well inside
 * one is drawn exactly once.
 */
function drawWrapped(
  x: number,
  y: number,
  reach: number,
  draw: (cx: number, cy: number) => void,
): void {
  for (const [ox, oy] of SEAM_OFFSETS) {
    const cx = x + ox;
    const cy = y + oy;
    if (cx < -reach || cx > FIELD_W + reach) continue;
    if (cy < -reach || cy > FIELD_H + reach) continue;
    draw(cx, cy);
  }
}

/** A filled circle. */
function disc(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** One line of text, in this build's one face. */
function text(
  ctx: Ctx,
  content: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
  weight = 600,
): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(content, x, y);
}

// ---- The star -------------------------------------------------------------

/**
 * The well: a bright core inside a halo whose intensity falls with distance and
 * reaches nothing at `1.5 x HALO_R`.
 */
function drawStar(ctx: Ctx): void {
  const halo = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    CORE_R,
    STAR_X,
    STAR_Y,
    STAR_REACH,
  );
  halo.addColorStop(0, withAlpha(COLOR.halo, 0.5));
  halo.addColorStop(0.28, withAlpha(COLOR.halo, 0.22));
  halo.addColorStop(0.62, withAlpha(COLOR.halo, 0.07));
  halo.addColorStop(1, withAlpha(COLOR.halo, 0));

  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, STAR_REACH, 0, Math.PI * 2);
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
  core.addColorStop(0.7, COLOR.core);
  core.addColorStop(1, COLOR.coreEdge);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, CORE_R, 0, Math.PI * 2);
  ctx.fill();
}

// ---- Rocks ----------------------------------------------------------------

/** How many corners a rock of that size is drawn with. */
const ROCK_CORNERS: Readonly<Record<RockSize, number>> = {
  large: 11,
  medium: 9,
  small: 7,
};

/** A stable pseudo-random in `[0, 1)` from two whole numbers. */
function jitter(id: number, index: number): number {
  const wave = Math.sin(id * 127.1 + index * 311.7) * 43758.5453;
  return wave - Math.floor(wave);
}

/** One rock: a lumpy silhouette, turned by its own drawn spin. */
function drawRock(ctx: Ctx, rock: DeepReadonly<RockState>): void {
  const radius = ROCK_RADIUS[rock.size];
  const corners = ROCK_CORNERS[rock.size];

  drawWrapped(rock.x, rock.y, radius + 2, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rock.spin);

    ctx.beginPath();
    for (let i = 0; i < corners; i += 1) {
      const angle = (i / corners) * Math.PI * 2;
      const reach = radius * (0.74 + jitter(rock.id, i) * 0.26);
      const px = Math.cos(angle) * reach;
      const py = Math.sin(angle) * reach;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = COLOR.rock;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLOR.rockRim;
    ctx.stroke();

    // A couple of craters, so a rock reads as rock rather than as a blob.
    const craters = rock.size === "small" ? 1 : 2;
    for (let i = 0; i < craters; i += 1) {
      const angle = jitter(rock.id, 40 + i) * Math.PI * 2;
      const away = radius * (0.16 + jitter(rock.id, 60 + i) * 0.36);
      disc(
        ctx,
        Math.cos(angle) * away,
        Math.sin(angle) * away,
        radius * (0.12 + jitter(rock.id, 80 + i) * 0.12),
        COLOR.rockShade,
      );
    }
    ctx.restore();
  });
}

// ---- Rounds ---------------------------------------------------------------

/**
 * The path a round travelled over the last `TRAIL_TICKS`, run backwards.
 *
 * The tail is derived rather than stored: stepping the round's own motion in
 * reverse gives the arc the well actually bent it along, so the way the star
 * curves a shot reads at a glance. The points come back UNWRAPPED and relative
 * to the round, so drawing them under `drawWrapped` follows it across a seam
 * instead of smearing the tail across the field.
 */
export function bulletTrail(
  bullet: DeepReadonly<BulletState>,
): readonly (readonly [number, number])[] {
  const path: [number, number][] = [[bullet.x, bullet.y]];

  // The span the tail is allowed: TRAIL_TICKS of the round's CURRENT travel.
  // The back-stepped arc is longer than that wherever the well was speeding the
  // round up, so the walk stops on the budget rather than on the tick count and
  // no drawn part of the tail is ever further from the round than its own span.
  const budget = Math.hypot(bullet.vx, bullet.vy) * TRAIL_TICKS * TICK_DT;
  if (budget === 0) return path;

  let x = bullet.x;
  let y = bullet.y;
  let vx = bullet.vx;
  let vy = bullet.vy;

  for (let i = 0; i < TRAIL_TICKS; i += 1) {
    const [ax, ay] = gravityAt(x, y);
    const nx = x - vx * TICK_DT;
    const ny = y - vy * TICK_DT;
    vx -= ax * TICK_DT;
    vy -= ay * TICK_DT;
    x = nx;
    y = ny;

    const away = Math.hypot(x - bullet.x, y - bullet.y);
    if (away > budget) {
      const back = path[path.length - 1];
      const step = Math.hypot(x - back[0], y - back[1]);
      const left = budget - Math.hypot(back[0] - bullet.x, back[1] - bullet.y);
      const cut = step === 0 ? 0 : Math.max(0, left / step);
      path.push([back[0] + (x - back[0]) * cut, back[1] + (y - back[1]) * cut]);
      return path;
    }
    path.push([x, y]);
  }
  return path;
}

/** One of the ship's rounds and the tapering tail behind it. */
function drawBullet(ctx: Ctx, bullet: DeepReadonly<BulletState>): void {
  const path = bulletTrail(bullet);
  const tip = path[path.length - 1];
  const reach = Math.hypot(tip[0] - bullet.x, tip[1] - bullet.y) + BULLET_R + 2;

  drawWrapped(bullet.x, bullet.y, reach, (cx, cy) => {
    const ox = cx - bullet.x;
    const oy = cy - bullet.y;

    ctx.lineCap = "round";
    for (let i = 0; i < path.length - 1; i += 1) {
      const fade = 1 - i / (path.length - 1);
      ctx.strokeStyle = withAlpha(COLOR.bullet, 0.75 * fade * fade);
      ctx.lineWidth = 0.6 + BULLET_R * 1.5 * fade;
      ctx.beginPath();
      ctx.moveTo(path[i][0] + ox, path[i][1] + oy);
      ctx.lineTo(path[i + 1][0] + ox, path[i + 1][1] + oy);
      ctx.stroke();
    }

    disc(ctx, cx, cy, BULLET_R + 0.8, COLOR.bullet);
  });
}

/** One saucer round: a hard red dot with a small glow. */
function drawEnemyBullet(ctx: Ctx, bullet: DeepReadonly<BulletState>): void {
  drawWrapped(bullet.x, bullet.y, SAUCER_BULLET_R + 6, (cx, cy) => {
    disc(ctx, cx, cy, SAUCER_BULLET_R + 4, withAlpha(COLOR.enemyBullet, 0.22));
    disc(ctx, cx, cy, SAUCER_BULLET_R + 0.8, COLOR.enemyBullet);
  });
}

// ---- The saucer -----------------------------------------------------------

/** The saucer: a flattened disc with a dome, unmistakably a craft. */
function drawSaucer(ctx: Ctx, saucer: DeepReadonly<SaucerState>): void {
  drawWrapped(saucer.x, saucer.y, SAUCER_R + 4, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);

    ctx.fillStyle = COLOR.saucerDome;
    ctx.beginPath();
    ctx.ellipse(0, -4, SAUCER_R * 0.5, SAUCER_R * 0.5, 0, Math.PI, 0);
    ctx.fill();

    ctx.fillStyle = COLOR.saucer;
    ctx.beginPath();
    ctx.ellipse(0, 0, SAUCER_R, SAUCER_R * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    // Below the centre, so the saucer's own hue is what a reading of its
    // position lands on.
    ctx.strokeStyle = COLOR.saucerDome;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-SAUCER_R * 0.9, 3.2);
    ctx.lineTo(SAUCER_R * 0.9, 3.2);
    ctx.stroke();

    for (const at of [-0.55, 0, 0.55]) {
      disc(ctx, at * SAUCER_R, SAUCER_R * 0.24, 1.8, COLOR.saucerDome);
    }
    ctx.restore();
  });
}

// ---- The ship -------------------------------------------------------------

/** The ship's outline in its own coordinates: 34 nose to tail, 26 across. */
const HULL: readonly (readonly [number, number])[] = [
  [17, 0],
  [-17, 13],
  [-11, 0],
  [-17, -13],
];

/**
 * The ship, drawn pointing along its facing.
 *
 * The respawn grace is drawn rather than reported: the hull dims and a ring
 * pulses around it while the window runs, and both settle the moment it ends.
 */
function drawShip(ctx: Ctx, ship: DeepReadonly<ShipState>): void {
  const grace = ship.invuln > 0;
  const bright =
    !grace || Math.floor(ship.invuln / (BLINK_PERIOD / 2)) % 2 === 0;
  const alpha = grace && !bright ? 0.35 : 1;

  drawWrapped(ship.x, ship.y, SHIP_R + 26, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ship.angle);
    ctx.globalAlpha = alpha;

    if (ship.thrusting) {
      ctx.fillStyle = COLOR.flame;
      ctx.beginPath();
      ctx.moveTo(-13, 8);
      ctx.lineTo(-30, 0);
      ctx.lineTo(-13, -8);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = COLOR.flameCore;
      ctx.beginPath();
      ctx.moveTo(-13, 4);
      ctx.lineTo(-22, 0);
      ctx.lineTo(-13, -4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(HULL[0][0], HULL[0][1]);
    for (const [px, py] of HULL.slice(1)) ctx.lineTo(px, py);
    ctx.closePath();
    ctx.fillStyle = COLOR.shipFill;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = COLOR.ship;
    ctx.stroke();

    // The nose marker: which way the ship points, at a glance.
    disc(ctx, 10, 0, 2.6, COLOR.shipNose);
    ctx.restore();

    if (grace && bright) {
      ctx.strokeStyle = withAlpha(COLOR.accent, 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, SHIP_R + 7, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

/** The small glyph the HUD draws one of per ship in reserve. */
function drawShipGlyph(ctx: Ctx, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.moveTo(HULL[0][0], HULL[0][1]);
  for (const [px, py] of HULL.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fillStyle = COLOR.shipFill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLOR.ship;
  ctx.stroke();
  ctx.restore();
}

// ---- The HUD and the field's overlays -------------------------------------

/** The score, and one glyph per ship in RESERVE, which is one fewer than left. */
function drawHud(ctx: Ctx, state: DeepReadonly<ShatterState>): void {
  text(
    ctx,
    String(state.score),
    HUD.x,
    HUD.scoreY,
    HUD.scoreSize,
    COLOR.text,
    "left",
    700,
  );

  const reserve = Math.max(0, state.lives - 1);
  for (let i = 0; i < reserve; i += 1) {
    drawShipGlyph(
      ctx,
      HUD.x + 9 + i * HUD.glyphGap,
      HUD.glyphY,
      HUD.glyphScale,
    );
  }
}

/** The `WAVE N` banner, centred on the field while it runs. */
function drawWaveBanner(ctx: Ctx, wave: number): void {
  text(
    ctx,
    `WAVE ${wave}`,
    FIELD_W / 2,
    FIELD_H / 2,
    74,
    COLOR.accent,
    "center",
    700,
  );
}

/** The announcement an extra ship makes on the field. */
function drawExtraLifeNotice(ctx: Ctx): void {
  text(ctx, "EXTRA SHIP", FIELD_W / 2, 470, 40, COLOR.accent, "center", 700);
}

/** A vertical menu with the highlighted entry drawn distinctly. */
function drawMenu(
  ctx: Ctx,
  items: readonly string[],
  highlighted: number,
  firstY: number,
  gap: number,
  size: number,
): void {
  items.forEach((item, index) => {
    const y = firstY + index * gap;
    const active = index === highlighted;
    if (active) {
      ctx.fillStyle = withAlpha(COLOR.accent, 0.16);
      ctx.fillRect(FIELD_W / 2 - 220, y - size * 0.8, 440, size * 1.6);
    }
    text(
      ctx,
      item,
      FIELD_W / 2,
      y,
      size,
      active ? COLOR.accent : COLOR.textDim,
      "center",
      active ? 700 : 600,
    );
  });
}

/** A dark wash over the field, so a menu over it stays legible. */
function drawScrim(ctx: Ctx, alpha: number): void {
  ctx.fillStyle = withAlpha("#000000", alpha);
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
}

// ---- The screens ----------------------------------------------------------

function drawTitle(ctx: Ctx, menuIndex: number): void {
  drawScrim(ctx, 0.55);
  text(ctx, TITLE_TEXT, FIELD_W / 2, 190, 110, COLOR.text, "center", 700);
  text(ctx, TAGLINE_TEXT, FIELD_W / 2, 268, 30, COLOR.accent);
  drawMenu(ctx, TITLE_ITEMS, menuIndex, 420, 68, 36);
  text(
    ctx,
    "ARROWS or WASD to fly   SPACE to fire   ENTER to choose",
    FIELD_W / 2,
    650,
    22,
    COLOR.textDim,
  );
}

/** How to play, in a player's words, naming every key the game binds. */
const HOWTO_LINES: readonly string[] = [
  "Shoot every rock down through its fragments to clear the wave.",
  "A Large breaks into two Mediums, a Medium into two Smalls, and a Small into nothing.",
  "",
  "The star pulls your shots and the rocks, but never your ship,",
  "so a shot can be curved around it onto a rock on its far side.",
  "A rock the star swallows is not gone: it comes back from the edge of the field.",
  "",
  "A saucer wanders in to hunt you, and it shoots. Shoot it down first.",
  "",
  "ARROWS or WASD turn and thrust.   SPACE fires.",
  "ENTER chooses.   ESC pauses and goes back.   P pauses.   M mutes.",
];

function drawHowTo(ctx: Ctx): void {
  drawScrim(ctx, 0.62);
  text(ctx, "HOW TO PLAY", FIELD_W / 2, 110, 54, COLOR.text, "center", 700);
  HOWTO_LINES.forEach((line, index) => {
    if (line === "") return;
    text(ctx, line, FIELD_W / 2, 210 + index * 38, 24, COLOR.text);
  });
  text(ctx, "ESC to go back", FIELD_W / 2, 660, 22, COLOR.textDim);
}

function drawPaused(ctx: Ctx, menuIndex: number): void {
  drawScrim(ctx, 0.45);
  text(ctx, "PAUSED", FIELD_W / 2, 190, 66, COLOR.text, "center", 700);
  drawMenu(ctx, PAUSE_ITEMS, menuIndex, 330, 68, 36);
}

function drawGameOver(
  ctx: Ctx,
  score: number,
  wave: number,
  menuIndex: number,
): void {
  drawScrim(ctx, 0.66);
  text(ctx, "GAME OVER", FIELD_W / 2, 160, 78, COLOR.text, "center", 700);

  text(ctx, "SCORE", FIELD_W / 2 - 170, 268, 26, COLOR.textDim);
  text(
    ctx,
    String(score),
    FIELD_W / 2 - 170,
    314,
    48,
    COLOR.accent,
    "center",
    700,
  );
  text(ctx, "WAVE", FIELD_W / 2 + 170, 268, 26, COLOR.textDim);
  text(
    ctx,
    String(wave),
    FIELD_W / 2 + 170,
    314,
    48,
    COLOR.accent,
    "center",
    700,
  );

  drawMenu(ctx, GAMEOVER_ITEMS, menuIndex, 440, 68, 36);
}

// ---- The whole frame ------------------------------------------------------

/** Draw the field and whatever screen is over it. */
export function renderGame(
  state: DeepReadonly<ShatterState>,
  ctx: Ctx,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, width, height);

  drawStar(ctx);
  for (const rock of state.rocks) drawRock(ctx, rock);
  for (const bullet of state.bullets) drawBullet(ctx, bullet);
  for (const bullet of state.enemyBullets) drawEnemyBullet(ctx, bullet);
  if (state.saucer !== null) drawSaucer(ctx, state.saucer);
  if (state.screen !== "title" && state.screen !== "howto") {
    drawShip(ctx, state.ship);
  }

  if (state.screen === "playing" || state.screen === "paused") {
    drawHud(ctx, state);
    if (state.waveBanner > 0) drawWaveBanner(ctx, state.wave);
    if (state.extraLifeNotice > 0) drawExtraLifeNotice(ctx);
  }

  switch (state.screen) {
    case "title":
      drawTitle(ctx, state.menuIndex);
      break;
    case "howto":
      drawHowTo(ctx);
      break;
    case "paused":
      drawPaused(ctx, state.menuIndex);
      break;
    case "gameover":
      drawGameOver(ctx, state.score, state.wave, state.menuIndex);
      break;
    case "playing":
      break;
  }

  ctx.restore();
}
