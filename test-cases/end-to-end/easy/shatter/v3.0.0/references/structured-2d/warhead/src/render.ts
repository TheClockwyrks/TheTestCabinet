// Shatter — the drawing: every layer of the picture, read off the live state.
//
// Every function here is a pure read of `ShatterState` (`specs/state.md`, The
// contract): rendering reads the state and writes nothing back. The context each
// one receives already carries the world-to-device transform, and the game
// leaves the camera at rest, so all of it is drawn in the field's own logical
// units.
//
// THE WRAP is the one thing to understand before reading further. The field is a
// torus, so a body whose shape crosses a seam is drawn on both sides at once.
// `drawWrapped` is that rule: it paints the body at its position and again at
// each of the eight field-sized offsets, skipping the ones that land wholly
// outside. Nine render components at fixed offsets would not do — a component's
// offset is composed with its actor's transform, so it would ROTATE with a
// spinning rock rather than tile the field.

import {
  BULLET_R,
  CORE_R,
  FIELD_H,
  FIELD_W,
  GAMEOVER_ITEMS,
  PAUSE_ITEMS,
  ROCK_HEALTH,
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
  TORPEDO_R,
  TRAIL_TICKS,
} from "./constants";
import type {
  BulletState,
  RockState,
  ShatterState,
  TorpedoState,
} from "./game";
import { TAU, wrapX, wrapY } from "./geometry";
import { gravityAt } from "./gravity";
import { COLOR, FONT } from "./theme";

/**
 * How far the halo is drawn.
 *
 * `specs/field.md` fixes two things about it: the intensity falls as the
 * distance from the star grows, and nothing of the star is drawn beyond
 * `1.5 x HALO_R` (`180`). This reach is inside that bound and past `HALO_R`
 * itself, so the falloff the field states is drawn over its whole stated range.
 */
const HALO_REACH = 168;

/** The offsets a wrapped draw tiles the field with. */
const WRAP_OFFSETS = [-1, 0, 1] as const;

/** A point in the field's logical units. */
interface Point {
  x: number;
  y: number;
}

/**
 * Paint one body wherever the wrap shows it: at its own position, and at each
 * field-sized offset that puts any part of it back on screen.
 */
function drawWrapped(
  x: number,
  y: number,
  reach: number,
  paint: (cx: number, cy: number) => void,
): void {
  for (const ix of WRAP_OFFSETS) {
    const cx = x + ix * FIELD_W;
    if (cx + reach < 0 || cx - reach > FIELD_W) continue;
    for (const iy of WRAP_OFFSETS) {
      const cy = y + iy * FIELD_H;
      if (cy + reach < 0 || cy - reach > FIELD_H) continue;
      paint(cx, cy);
    }
  }
}

/** A colour part-way between two `#rrggbb` values. */
function mix(from: string, to: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

// ---- The star ------------------------------------------------------------

/**
 * The star: a bright core with a softer halo fading outward into the field.
 *
 * The halo's intensity falls from `CORE_R` outward and reaches nothing at
 * `HALO_REACH`, so nothing of the star is drawn beyond `1.5 x HALO_R`.
 */
export function renderStar(ctx: CanvasRenderingContext2D): void {
  const halo = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    CORE_R,
    STAR_X,
    STAR_Y,
    HALO_REACH,
  );
  halo.addColorStop(0, "rgba(255, 179, 71, 0.62)");
  halo.addColorStop(0.35, "rgba(255, 150, 60, 0.24)");
  halo.addColorStop(0.7, "rgba(255, 120, 50, 0.07)");
  halo.addColorStop(1, "rgba(255, 120, 50, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, HALO_REACH, 0, TAU);
  ctx.fill();

  const core = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    0,
    STAR_X,
    STAR_Y,
    CORE_R,
  );
  core.addColorStop(0, "#ffffff");
  core.addColorStop(0.6, COLOR.starCore);
  core.addColorStop(1, COLOR.starHalo);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, CORE_R, 0, TAU);
  ctx.fill();
}

// ---- The rocks -----------------------------------------------------------

/**
 * The outline a rock of that id is drawn with: an irregular ring whose radii are
 * a function of the id alone, so a rock keeps its shape for its whole life.
 *
 * Every radius stays outside `0.9` of the collision radius, so the disc a player
 * reads as the rock covers the circle it actually collides as.
 */
function rockOutline(id: number, radius: number): Point[] {
  const count = 11;
  const points: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    const hash =
      Math.imul((id + 1) ^ Math.imul(index + 1, 0x9e3779b9), 0x27d4eb2d) >>> 0;
    const jitter = 0.9 + (hash / 4294967296) * 0.22;
    const angle = (index / count) * TAU;
    points.push({
      x: Math.cos(angle) * radius * jitter,
      y: Math.sin(angle) * radius * jitter,
    });
  }
  return points;
}

/** One rock, at one of the places the wrap shows it. */
function paintRock(
  ctx: CanvasRenderingContext2D,
  rock: RockState,
  cx: number,
  cy: number,
): void {
  const radius = ROCK_RADIUS[rock.size];
  const full = ROCK_HEALTH[rock.size];
  const damage = full <= 1 ? 0 : 1 - (rock.health - 1) / (full - 1);
  const body =
    rock.flash > 0
      ? COLOR.rockFlash
      : mix(COLOR.rockWhole, COLOR.rockBroken, damage);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rock.spin);

  const outline = rockOutline(rock.id, radius);
  ctx.beginPath();
  outline.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();

  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = rock.flash > 0 ? "#ffffff" : mix(body, "#ffffff", 0.35);
  ctx.stroke();

  // The damage a rock carries, drawn as fissures across it: none at full
  // health, more of them as the health falls.
  const cracks = Math.round(damage * (full - 1) * 2);
  if (cracks > 0) {
    ctx.strokeStyle = "rgba(10, 12, 20, 0.75)";
    ctx.lineWidth = Math.max(2, radius * 0.09);
    for (let index = 0; index < cracks; index += 1) {
      const angle = (index / cracks) * TAU + rock.id;
      ctx.beginPath();
      ctx.moveTo(
        Math.cos(angle) * radius * 0.85,
        Math.sin(angle) * radius * 0.85,
      );
      ctx.lineTo(
        Math.cos(angle + 2.3) * radius * 0.45,
        Math.sin(angle + 2.3) * radius * 0.45,
      );
      ctx.stroke();
    }
  }

  ctx.restore();
}

/** Every rock on the field. */
export function renderRocks(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  for (const rock of state.rocks) {
    const reach = ROCK_RADIUS[rock.size] * 1.2;
    drawWrapped(rock.x, rock.y, reach, (cx, cy) =>
      paintRock(ctx, rock, cx, cy),
    );
  }
}

// ---- The rounds in flight ------------------------------------------------

/**
 * The path a round covered over the last `TRAIL_TICKS` ticks, reconstructed by
 * stepping its own motion and the star's pull backwards from where it stands.
 *
 * The points come back in coordinates continuous with the round's current
 * position rather than wrapped, so a trail that crosses a seam is one unbroken
 * streak the wrapped draw then shows at both edges.
 */
function trailPath(bullet: BulletState): Point[] {
  const points: Point[] = [{ x: bullet.x, y: bullet.y }];
  let x = bullet.x;
  let y = bullet.y;
  let vx = bullet.vx;
  let vy = bullet.vy;

  for (let step = 0; step < TRAIL_TICKS; step += 1) {
    x -= vx * TICK_DT;
    y -= vy * TICK_DT;
    const { ax, ay } = gravityAt(wrapX(x), wrapY(y));
    vx -= ax * TICK_DT;
    vy -= ay * TICK_DT;
    points.push({ x, y });
  }
  return points;
}

/** One round and the tail behind it, at one of the places the wrap shows it. */
function paintRound(
  ctx: CanvasRenderingContext2D,
  path: Point[],
  colour: string,
  radius: number,
  offsetX: number,
  offsetY: number,
): void {
  ctx.lineCap = "round";
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    const fade = 1 - index / path.length;
    ctx.globalAlpha = fade * 0.85;
    ctx.lineWidth = radius * 1.6 * fade + 0.4;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(from.x + offsetX, from.y + offsetY);
    ctx.lineTo(to.x + offsetX, to.y + offsetY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const head = path[0];
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(head.x + offsetX, head.y + offsetY, radius * 0.55, 0, TAU);
  ctx.fill();
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(head.x + offsetX, head.y + offsetY, radius, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** One roster of rounds, each with its tail. */
function renderRoster(
  roster: BulletState[],
  ctx: CanvasRenderingContext2D,
  colour: string,
  radius: number,
): void {
  for (const bullet of roster) {
    const path = trailPath(bullet);
    const reach =
      Math.hypot(bullet.vx, bullet.vy) * TRAIL_TICKS * TICK_DT + radius * 2;
    drawWrapped(bullet.x, bullet.y, reach, (cx, cy) => {
      paintRound(ctx, path, colour, radius, cx - bullet.x, cy - bullet.y);
    });
  }
}

/** Every one of the ship's bullets. */
export function renderBullets(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  renderRoster(state.bullets, ctx, COLOR.bullet, BULLET_R + 1);
}

/** Every saucer bullet. */
export function renderEnemyBullets(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  renderRoster(state.enemyBullets, ctx, COLOR.enemyBullet, SAUCER_BULLET_R + 1);
}

// ---- The torpedoes -------------------------------------------------------

/** One torpedo, at one of the places the wrap shows it. */
function paintTorpedo(
  ctx: CanvasRenderingContext2D,
  torpedo: TorpedoState,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(torpedo.heading);

  // The exhaust, so the heavy weapon reads as driven rather than thrown.
  ctx.fillStyle = COLOR.torpedoFlame;
  ctx.globalAlpha = 0.65;
  ctx.beginPath();
  ctx.moveTo(-11, -4);
  ctx.lineTo(-24, 0);
  ctx.lineTo(-11, 4);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = COLOR.torpedo;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(2, -TORPEDO_R);
  ctx.lineTo(-11, -TORPEDO_R);
  ctx.lineTo(-11, TORPEDO_R);
  ctx.lineTo(2, TORPEDO_R);
  ctx.closePath();
  ctx.fill();

  // The fins, which no bullet has.
  ctx.beginPath();
  ctx.moveTo(-6, -TORPEDO_R);
  ctx.lineTo(-13, -TORPEDO_R * 2.1);
  ctx.lineTo(-13, -TORPEDO_R);
  ctx.closePath();
  ctx.moveTo(-6, TORPEDO_R);
  ctx.lineTo(-13, TORPEDO_R * 2.1);
  ctx.lineTo(-13, TORPEDO_R);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(-2, 0);
  ctx.stroke();

  ctx.restore();
}

/** Every torpedo in flight. */
export function renderTorpedoes(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  for (const torpedo of state.torpedoes) {
    drawWrapped(torpedo.x, torpedo.y, 26, (cx, cy) =>
      paintTorpedo(ctx, torpedo, cx, cy),
    );
  }
}

// ---- The ship ------------------------------------------------------------

/** The hull, in the ship's own frame: `34` from nose to tail, `26` at the tail. */
function shipPath(ctx: CanvasRenderingContext2D, scale: number): void {
  ctx.beginPath();
  ctx.moveTo(17 * scale, 0);
  ctx.lineTo(-17 * scale, 13 * scale);
  ctx.lineTo(-9 * scale, 0);
  ctx.lineTo(-17 * scale, -13 * scale);
  ctx.closePath();
}

/** The ship, at one of the places the wrap shows it. */
function paintShip(
  ctx: CanvasRenderingContext2D,
  state: ShatterState,
  cx: number,
  cy: number,
): void {
  const ship = state.ship;
  // Inside the respawn grace the hull is drawn as a bare outline on alternate
  // eighths of a second, so the ship reads as protected and settles the instant
  // the grace ends. On the other half of the cycle it is exactly the steady
  // ship.
  const blinking = ship.invuln > 0 && Math.floor(ship.invuln * 8) % 2 === 1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ship.angle);

  if (ship.thrusting) {
    const flicker = 10 + (Math.floor(state.simTime * 40) % 3) * 5;
    ctx.fillStyle = COLOR.flame;
    ctx.beginPath();
    ctx.moveTo(-14, -7);
    ctx.lineTo(-14 - flicker, 0);
    ctx.lineTo(-14, 7);
    ctx.closePath();
    ctx.fill();
  }

  shipPath(ctx, 1);
  if (blinking) {
    ctx.strokeStyle = COLOR.shipEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    ctx.fillStyle = COLOR.ship;
    ctx.fill();
    ctx.strokeStyle = COLOR.shipEdge;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}

/** The ship. */
export function renderShip(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  drawWrapped(state.ship.x, state.ship.y, SHIP_R + 26, (cx, cy) =>
    paintShip(ctx, state, cx, cy),
  );
}

// ---- The saucer ----------------------------------------------------------

/** The saucer, at one of the places the wrap shows it. */
function paintSaucer(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = COLOR.saucerDome;
  ctx.beginPath();
  ctx.ellipse(0, -4, SAUCER_R * 0.5, SAUCER_R * 0.5, 0, Math.PI, 0);
  ctx.fill();

  ctx.fillStyle = COLOR.saucer;
  ctx.beginPath();
  ctx.ellipse(0, 0, SAUCER_R, SAUCER_R * 0.42, 0, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = COLOR.saucerDome;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-SAUCER_R, 0);
  ctx.lineTo(SAUCER_R, 0);
  ctx.stroke();

  ctx.fillStyle = COLOR.saucerDome;
  for (const at of [-9, 0, 9]) {
    ctx.beginPath();
    ctx.arc(at, 4, 1.6, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

/** The saucer, while one is visiting. */
export function renderSaucer(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  const saucer = state.saucer;
  if (saucer === null) return;
  drawWrapped(saucer.x, saucer.y, SAUCER_R + 4, (cx, cy) =>
    paintSaucer(ctx, cx, cy),
  );
}

// ---- The HUD -------------------------------------------------------------

/** A plate behind a line of copy, so it reads over whatever it is drawn on. */
function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = "rgba(4, 6, 14, 0.78)";
  ctx.fillRect(x - width / 2, y - height / 2, width, height);
}

/** One line of centred copy. */
function centred(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  font: string,
  colour: string,
): void {
  ctx.font = font;
  ctx.fillStyle = colour;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, FIELD_W / 2, y);
}

/**
 * The HUD, and the two announcements drawn over the field.
 *
 * All of it sits in the upper left and along the top, clear of the field's
 * centre where the star and the play are.
 */
export function renderHud(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.font = FONT.score;
  ctx.fillStyle = COLOR.text;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(state.score), 34, 44);

  // One glyph per ship in reserve: one fewer than the run has left, since the
  // ship being flown is on the field rather than in the row.
  const reserve = Math.max(0, Math.round(state.lives) - 1);
  ctx.fillStyle = COLOR.ship;
  ctx.strokeStyle = COLOR.shipEdge;
  ctx.lineWidth = 1.2;
  for (let index = 0; index < reserve; index += 1) {
    ctx.save();
    ctx.translate(42 + index * 30, 84);
    ctx.rotate(-Math.PI / 2);
    shipPath(ctx, 0.62);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // The torpedo: the glyph lit while one is ready, dimmed while the charge
  // rises, over a bar that fills smoothly across the recharge.
  const ready = state.torpedoCharge >= 1;
  ctx.save();
  ctx.translate(44, 124);
  ctx.rotate(-Math.PI / 2);
  ctx.globalAlpha = ready ? 1 : 0.4;
  ctx.fillStyle = COLOR.torpedo;
  ctx.beginPath();
  ctx.moveTo(13, 0);
  ctx.lineTo(2, -5);
  ctx.lineTo(-10, -5);
  ctx.lineTo(-10, 5);
  ctx.lineTo(2, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(138, 255, 193, 0.22)";
  ctx.fillRect(34, 142, 104, 9);
  ctx.fillStyle = COLOR.torpedo;
  ctx.fillRect(34, 142, 104 * Math.max(0, Math.min(1, state.torpedoCharge)), 9);

  if (state.waveBanner > 0) {
    plate(ctx, FIELD_W / 2, 262, 420, 92);
    centred(ctx, `WAVE ${String(state.wave)}`, 262, FONT.banner, COLOR.accent);
  }

  if (state.extraFlash > 0) {
    plate(ctx, FIELD_W / 2, 150, 340, 56);
    centred(ctx, "EXTRA SHIP", 150, FONT.menu, COLOR.accent);
  }
}

// ---- The screens ---------------------------------------------------------

/** A vertical menu, its highlighted entry drawn distinctly from the others. */
function menu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  index: number,
  top: number,
  step: number,
): void {
  const count = items.length;
  const selected = ((Math.round(index) % count) + count) % count;
  items.forEach((item, at) => {
    const chosen = at === selected;
    const text = chosen ? `> ${item} <` : item;
    centred(
      ctx,
      text,
      top + at * step,
      FONT.menu,
      chosen ? COLOR.accent : COLOR.textDim,
    );
  });
}

/** The lines the how-to screen explains the game in. */
const HOWTO_LINES = [
  "Fly under pure momentum. Turn, thrust, and shoot every rock down through",
  "its fragments to clear the wave and bring on the next one.",
  "",
  "The star at the centre pulls every bullet and every rock, and never your",
  "ship, so a shot bends around it to strike a rock on the far side.",
  "",
  "A rock the star swallows is not gone: it comes back in from the edge of",
  "the field, carrying the damage it already had.",
  "",
  "Larger rocks are armored. They take several hits to break, and they show",
  "the damage they have taken as they take it.",
  "",
  "A saucer wanders in to hunt you, and it can be shot down.",
  "",
  "The torpedo is one guided munition on a ten-second recharge. It homes",
  "onto the nearest body in a narrow cone ahead of it, flies true through",
  "the well, and destroys any rock outright.",
] as const;

/** The keys, one control to a line. */
const HOWTO_KEYS = [
  "TURN   ARROWS   or   WASD",
  "THRUST   ARROWS   or   WASD          FIRE   SPACE          TORPEDO   F",
  "CONFIRM   ENTER          PAUSE   P   or   ESC          MUTE   M",
] as const;

/** Whichever screen is up, drawn over everything else. */
export function renderScreens(
  state: ShatterState,
  ctx: CanvasRenderingContext2D,
): void {
  switch (state.screen) {
    case "title":
      centred(ctx, TITLE_TEXT, 110, FONT.title, COLOR.text);
      centred(ctx, TAGLINE_TEXT, 176, FONT.body, COLOR.textDim);
      menu(ctx, TITLE_ITEMS, state.menuIndex, 596, 56);
      break;

    case "howto": {
      centred(ctx, "HOW TO PLAY", 78, FONT.heading, COLOR.text);
      ctx.font = "400 22px 'Trebuchet MS', 'Segoe UI', sans-serif";
      ctx.fillStyle = COLOR.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      HOWTO_LINES.forEach((line, index) => {
        if (line !== "") ctx.fillText(line, FIELD_W / 2, 140 + index * 26);
      });
      ctx.fillStyle = COLOR.accent;
      HOWTO_KEYS.forEach((line, index) => {
        ctx.fillText(line, FIELD_W / 2, 600 + index * 30);
      });
      centred(
        ctx,
        "ESC   RETURNS TO THE TITLE",
        696,
        FONT.label,
        COLOR.textDim,
      );
      break;
    }

    case "paused":
      ctx.fillStyle = COLOR.scrim;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      centred(ctx, "PAUSED", 208, FONT.heading, COLOR.text);
      menu(ctx, PAUSE_ITEMS, state.menuIndex, 336, 62);
      break;

    case "gameover":
      centred(ctx, "GAME OVER", 190, FONT.heading, COLOR.text);
      centred(
        ctx,
        `SCORE   ${String(state.score)}`,
        286,
        FONT.menu,
        COLOR.text,
      );
      centred(ctx, `WAVE   ${String(state.wave)}`, 336, FONT.menu, COLOR.text);
      menu(ctx, GAMEOVER_ITEMS, state.menuIndex, 462, 58);
      break;

    case "playing":
      break;
  }
}

/** Whether the field's bodies are drawn on the screen currently up. */
export function fieldIsShown(state: ShatterState): boolean {
  return state.screen === "playing" || state.screen === "paused";
}

/** Whether the star is drawn on the screen currently up. */
export function starIsShown(state: ShatterState): boolean {
  return fieldIsShown(state) || state.screen === "title";
}
