// Shatter — drawing the field.
//
// Everything here reads the state and draws; nothing writes to it, so the
// simulation and the picture are decoupled in the one direction
// `specs/simulation.md` requires — the game never reads the renderer, and a
// scenario driven from code reaches the same state whether or not anything was
// ever drawn.
//
// Two rules shape the file. THE FIELD IS A TORUS, so a body within its own radius
// of a seam is drawn on BOTH sides at once (`specs/field.md`); every body goes
// through {@link drawWrapped}, which draws it once per wrapped copy that has any
// part inside the field. And THE LOOK IS THIS BUILD'S, so every color, size and
// piece of layout comes from `src/theme.ts` while every figure the specification
// fixes comes from `src/constants.ts`.
//
// The one figure the specification fixes about the drawing is the star: nothing
// of it is drawn beyond `1.5 x HALO_R`, and its halo fades outward from the core.

import {
  BULLET_R,
  CORE_R,
  FIELD_H,
  FIELD_W,
  HALO_R,
  SAUCER_BULLET_R,
  SAUCER_R,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TAGLINE_TEXT,
  TAU,
  TITLE_TEXT,
  type Screen,
} from "./constants";
import { shortestDelta, wrapOffsets } from "./geometry";
import { menuLayout } from "./menus";
import { COLOR, FONT, HUD, SHIP_ART, TYPE } from "./theme";
import type { Bullet, EnemyBullet, Rock, Saucer, ShatterState } from "./types";

/** How many times a second the respawn grace alternates the ship's look. */
const GRACE_BLINK_HZ = 12;

/** Draw the whole game as it stands. */
export function renderGame(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  drawStar(ctx);

  if (state.screen !== "title" && state.screen !== "howto") {
    drawField(state, ctx);
    drawHud(state, ctx);
    if (state.waveBanner > 0) drawBanner(state, ctx);
    if (state.extraLifeShow > 0) drawAward(ctx);
  }

  if (state.screen === "title") drawTitle(state, ctx);
  else if (state.screen === "howto") drawHowTo(ctx);
  else if (state.screen === "paused") drawPause(state, ctx);
  else if (state.screen === "gameover") drawGameOver(state, ctx);
}

// ---- The field -----------------------------------------------------------

/** Every body, in the order that keeps the ship readable over the debris. */
function drawField(state: ShatterState, ctx: CanvasRenderingContext2D): void {
  for (const rock of state.rocks) drawRock(ctx, rock);
  for (const bullet of state.bullets) drawBullet(ctx, bullet);
  for (const bullet of state.enemyBullets) drawEnemyBullet(ctx, bullet);
  if (state.saucer !== null) drawSaucer(ctx, state.saucer);
  drawShip(state, ctx);
}

/**
 * Draw a body once for each wrapped copy of it that has any part inside the
 * field, so a body straddling a seam shows at both edges at once.
 */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): void {
  for (const offset of wrapOffsets(x, y, radius)) {
    ctx.save();
    ctx.translate(x + offset.x, y + offset.y);
    draw(ctx);
    ctx.restore();
  }
}

/**
 * The star: a bright solid core with a halo fading outward into the field.
 *
 * The halo's intensity falls from the core out to `HALO_R` and stops there, so
 * nothing of the star is drawn beyond `1.5 x HALO_R` and the falloff has no rim
 * or spike in it. The star is at the centre of the field and never near a seam,
 * so it is the one thing here that is not drawn wrapped.
 */
function drawStar(ctx: CanvasRenderingContext2D): void {
  const halo = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    CORE_R,
    STAR_X,
    STAR_Y,
    HALO_R,
  );
  halo.addColorStop(0, "rgba(255, 138, 62, 0.55)");
  halo.addColorStop(0.45, "rgba(255, 112, 48, 0.2)");
  halo.addColorStop(1, "rgba(255, 96, 40, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, HALO_R, 0, TAU);
  ctx.fill();

  ctx.fillStyle = COLOR.starCore;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, CORE_R, 0, TAU);
  ctx.fill();

  ctx.fillStyle = "#fff6de";
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, CORE_R * 0.45, 0, TAU);
  ctx.fill();
}

/** Two colors mixed, as a CSS color. */
function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (i: number): number => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** The three channels of a `#rrggbb` color. */
function parseHex(color: string): [number, number, number] {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** A rock: an irregular outline turned by its drawn spin. */
function drawRock(ctx: CanvasRenderingContext2D, rock: Rock): void {
  drawWrapped(ctx, rock.x, rock.y, rock.radius, (c) => {
    c.rotate(rock.angle);
    c.beginPath();
    rock.verts.forEach((radius, index) => {
      const angle = (index / rock.verts.length) * TAU;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.closePath();
    c.fillStyle = COLOR.rock;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = COLOR.text;
    c.stroke();
  });
}

/**
 * A bullet and the fading tail along its recent travel.
 *
 * The tail is laid out RELATIVE TO THE BULLET, each recorded sample brought to
 * the near side of the seams, so a bullet that has just wrapped draws its tail
 * behind it at the opposite edge rather than smearing across the field. It tapers
 * from the bullet — widest and brightest where it meets it — and spans the last
 * `TRAIL_TICKS` ticks of travel, so its drawn length is proportional to the
 * bullet's speed.
 */
function drawBullet(ctx: CanvasRenderingContext2D, bullet: Bullet): void {
  const points = bullet.trail.map((sample) => {
    const delta = shortestDelta(bullet.x, bullet.y, sample.x, sample.y);
    return { x: delta.x, y: delta.y };
  });
  const span = Math.max(
    BULLET_R,
    ...points.map((point) => Math.hypot(point.x, point.y)),
  );

  drawWrapped(ctx, bullet.x, bullet.y, span, (c) => {
    c.lineCap = "round";
    for (let i = 1; i < points.length; i += 1) {
      const along = i / (points.length - 1);
      c.strokeStyle = `rgba(244, 248, 255, ${(0.06 + 0.62 * along).toFixed(3)})`;
      c.lineWidth = 0.8 + BULLET_R * 1.5 * along;
      c.beginPath();
      c.moveTo(points[i - 1].x, points[i - 1].y);
      c.lineTo(points[i].x, points[i].y);
      c.stroke();
    }
    c.fillStyle = COLOR.bullet;
    c.beginPath();
    c.arc(0, 0, BULLET_R + 0.6, 0, TAU);
    c.fill();
  });
}

/** A saucer bullet: the same size as the ship's, in the saucer's own color. */
function drawEnemyBullet(
  ctx: CanvasRenderingContext2D,
  bullet: EnemyBullet,
): void {
  drawWrapped(ctx, bullet.x, bullet.y, SAUCER_BULLET_R + 2, (c) => {
    c.fillStyle = COLOR.enemyBullet;
    c.beginPath();
    c.arc(0, 0, SAUCER_BULLET_R + 0.8, 0, TAU);
    c.fill();
  });
}

/** The saucer: a flattened disc with a canopy, a craft rather than debris. */
function drawSaucer(ctx: CanvasRenderingContext2D, saucer: Saucer): void {
  drawWrapped(ctx, saucer.x, saucer.y, SAUCER_R * 1.6, (c) => {
    c.fillStyle = COLOR.saucer;
    c.beginPath();
    c.ellipse(0, 2, SAUCER_R * 1.5, SAUCER_R * 0.5, 0, 0, TAU);
    c.fill();
    c.beginPath();
    c.ellipse(0, 0, SAUCER_R * 0.72, SAUCER_R * 0.62, 0, Math.PI, TAU);
    c.fill();
    c.fillStyle = COLOR.saucerGlass;
    c.beginPath();
    c.ellipse(0, -1, SAUCER_R * 0.4, SAUCER_R * 0.34, 0, Math.PI, TAU);
    c.fill();
  });
}

/**
 * The ship, and the flame behind it while thrust is applied.
 *
 * Inside the respawn grace the hull alternates between its steady look and a
 * protected one at {@link GRACE_BLINK_HZ}, so a ship in its grace reads as such
 * and settles the moment the grace ends.
 */
function drawShip(state: ShatterState, ctx: CanvasRenderingContext2D): void {
  const ship = state.ship;
  const protectedNow =
    ship.invuln > 0 && Math.floor(state.simTime * GRACE_BLINK_HZ) % 2 === 1;

  drawWrapped(ctx, ship.x, ship.y, SHIP_R * 3, (c) => {
    c.rotate(ship.angle);
    if (ship.thrusting) drawFlame(c, state.simTime);
    drawHull(c, protectedNow);
  });
}

/** The hull, at the origin, pointing along the positive `x` axis. */
function drawHull(ctx: CanvasRenderingContext2D, protectedNow: boolean): void {
  const hull = protectedNow ? COLOR.shipGrace : COLOR.ship;
  ctx.beginPath();
  ctx.moveTo(SHIP_ART.nose, 0);
  ctx.lineTo(-SHIP_ART.tail, SHIP_ART.halfBeam);
  ctx.lineTo(-SHIP_ART.tail * 0.45, 0);
  ctx.lineTo(-SHIP_ART.tail, -SHIP_ART.halfBeam);
  ctx.closePath();
  ctx.fillStyle = mix(hull, "#06131a", 0.45);
  ctx.fill();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = hull;
  ctx.stroke();
  if (!protectedNow) return;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgba(255, 226, 122, 0.75)";
  ctx.beginPath();
  ctx.arc(0, 0, SHIP_R + 6, 0, TAU);
  ctx.stroke();
}

/**
 * The thrust flame, trailing from the tail.
 *
 * Its flicker is drawn from the simulation clock rather than from a random draw,
 * so nothing the renderer does can move the seeded generator the field is built
 * from.
 */
function drawFlame(ctx: CanvasRenderingContext2D, simTime: number): void {
  const flicker = 0.7 + 0.3 * Math.abs(Math.sin(simTime * 47));
  const reach = SHIP_ART.tail + SHIP_ART.flame * flicker;
  ctx.beginPath();
  ctx.moveTo(-SHIP_ART.tail, SHIP_ART.halfBeam * 0.55);
  ctx.lineTo(-reach, 0);
  ctx.lineTo(-SHIP_ART.tail, -SHIP_ART.halfBeam * 0.55);
  ctx.closePath();
  ctx.fillStyle = COLOR.thrust;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-SHIP_ART.tail, SHIP_ART.halfBeam * 0.3);
  ctx.lineTo(-SHIP_ART.tail - SHIP_ART.flame * 0.5 * flicker, 0);
  ctx.lineTo(-SHIP_ART.tail, -SHIP_ART.halfBeam * 0.3);
  ctx.closePath();
  ctx.fillStyle = COLOR.thrustCore;
  ctx.fill();
}

// ---- Text and panels -----------------------------------------------------

/** One run of text, in the build's own face. */
function text(
  ctx: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "left",
): void {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(content, x, y);
}

/** A dark plate, so text over the star or the field still reads against it. */
function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string = COLOR.panel,
): void {
  const radius = Math.min(14, width / 2, height / 2);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

/**
 * A vertical menu: the highlighted entry in the accent color with a caret beside
 * it, every other entry dimmed.
 *
 * The caret is a drawn shape rather than part of the entry's text, so each
 * entry's copy is exactly what `specs/ui.md` fixes it as.
 */
function menu(
  ctx: CanvasRenderingContext2D,
  screen: Screen,
  index: number,
): void {
  const layout = menuLayout(screen);
  if (layout === null) return;
  const items = layout.entries;
  const centreX = FIELD_W / 2;
  const selected = ((index % items.length) + items.length) % items.length;
  items.forEach((item, i) => {
    const y = layout.top + i * layout.step;
    const chosen = i === selected;
    text(
      ctx,
      item,
      centreX,
      y,
      TYPE.menu,
      chosen ? COLOR.accent : COLOR.textDim,
      "center",
    );
    if (!chosen) return;
    const width = ctx.measureText(item).width;
    ctx.fillStyle = COLOR.accent;
    ctx.beginPath();
    ctx.moveTo(centreX - width / 2 - 26, y - 9);
    ctx.lineTo(centreX - width / 2 - 12, y);
    ctx.lineTo(centreX - width / 2 - 26, y + 9);
    ctx.closePath();
    ctx.fill();
  });
}

// ---- The HUD -------------------------------------------------------------

/**
 * The HUD: the score, and one glyph per ship in RESERVE.
 *
 * The reserve count is one fewer than the run has left, because the ship being
 * flown is on the field rather than in the row (`specs/ui.md`). Every readout
 * sits in the upper left, clear of the field's centre.
 */
function drawHud(state: ShatterState, ctx: CanvasRenderingContext2D): void {
  text(
    ctx,
    String(state.score),
    HUD.scoreX,
    HUD.scoreY + HUD.scoreSize / 2,
    HUD.scoreSize,
    COLOR.accent,
  );

  const reserve = Math.max(0, state.lives - 1);
  for (let i = 0; i < reserve; i += 1) {
    ctx.save();
    ctx.translate(HUD.livesX + i * HUD.livesGap, HUD.livesY);
    ctx.rotate(-Math.PI / 2);
    ctx.scale(HUD.livesScale, HUD.livesScale);
    drawHull(ctx, false);
    ctx.restore();
  }
}

/** The `WAVE N` banner, centred on the field while it runs. */
function drawBanner(state: ShatterState, ctx: CanvasRenderingContext2D): void {
  const label = `WAVE ${state.wave}`;
  ctx.font = `${TYPE.banner}px ${FONT}`;
  const width = ctx.measureText(label).width;
  panel(
    ctx,
    FIELD_W / 2 - width / 2 - 40,
    FIELD_H / 2 - TYPE.banner * 0.8,
    width + 80,
    TYPE.banner * 1.6,
  );
  text(ctx, label, FIELD_W / 2, FIELD_H / 2, TYPE.banner, COLOR.text, "center");
}

/** The announcement that an extra ship has been granted. */
function drawAward(ctx: CanvasRenderingContext2D): void {
  const label = "EXTRA SHIP";
  ctx.font = `${TYPE.award}px ${FONT}`;
  const width = ctx.measureText(label).width;
  panel(ctx, FIELD_W / 2 - width / 2 - 24, 546, width + 48, 48);
  text(ctx, label, FIELD_W / 2, 570, TYPE.award, COLOR.accent, "center");
}

// ---- The screens ---------------------------------------------------------

/**
 * The title: the name and the tagline above the star, and the two entries below
 * it.
 *
 * Both plates are clear of the star, so the well the game is built around is the
 * first thing the screen shows and each run of text still reads against a
 * backing of its own.
 */
function drawTitle(state: ShatterState, ctx: CanvasRenderingContext2D): void {
  panel(ctx, 300, 84, 680, 160);
  text(ctx, TITLE_TEXT, FIELD_W / 2, 152, TYPE.title, COLOR.text, "center");
  text(
    ctx,
    TAGLINE_TEXT,
    FIELD_W / 2,
    216,
    TYPE.tagline,
    COLOR.textDim,
    "center",
  );

  panel(ctx, 440, 506, 400, 142);
  menu(ctx, "title", state.menuIndex);
}

/** How to play, in a player's words. */
function drawHowTo(ctx: CanvasRenderingContext2D): void {
  panel(ctx, 130, 60, 1020, 600);
  text(
    ctx,
    "HOW TO PLAY",
    FIELD_W / 2,
    118,
    TYPE.heading,
    COLOR.text,
    "center",
  );

  const lines = [
    "Shoot every rock down, through its fragments, to clear a wave.",
    "A Large breaks into two Medium, a Medium into two Small, and a",
    "Small into nothing at all.",
    "",
    "The star pulls your shots and the rocks, but never your ship,",
    "so a shot can be curved around it onto a rock on the far side.",
    "A rock the star swallows comes straight back from the edge.",
    "",
    "A saucer wanders in to hunt you. Shoot it down before it lands",
    "a shot on you.",
    "",
    "ARROWS or WASD to turn and thrust.",
    "SPACE fires the gun.",
    "P or ESC pauses.",
    "ENTER confirms a menu entry.",
    "M turns the sound on and off.",
    "",
    "ESC goes back.",
  ];
  lines.forEach((line, index) => {
    if (line === "") return;
    text(ctx, line, 190, 196 + index * 24, TYPE.body, COLOR.textDim);
  });
}

/** The pause menu, over the frozen field. */
function drawPause(state: ShatterState, ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  panel(ctx, 420, 200, 440, 320);
  text(ctx, "PAUSED", FIELD_W / 2, 260, TYPE.heading, COLOR.text, "center");
  menu(ctx, "paused", state.menuIndex);
}

/** The game-over screen: the final score, the wave reached, and where to go. */
function drawGameOver(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  panel(ctx, 380, 140, 520, 440);
  text(ctx, "GAME OVER", FIELD_W / 2, 210, TYPE.heading, COLOR.text, "center");

  text(ctx, "SCORE", FIELD_W / 2, 274, TYPE.body, COLOR.textDim, "center");
  text(
    ctx,
    String(state.score),
    FIELD_W / 2,
    316,
    TYPE.heading,
    COLOR.accent,
    "center",
  );
  text(ctx, "WAVE", FIELD_W / 2, 366, TYPE.body, COLOR.textDim, "center");
  text(
    ctx,
    String(state.wave),
    FIELD_W / 2,
    404,
    TYPE.heading,
    COLOR.accent,
    "center",
  );

  menu(ctx, "gameover", state.menuIndex);
}
