// Shatter — all rendering. Everything is drawn in logical 1280x720 space;
// main.ts sets the canvas transform so this scales to the window. The look is
// neon-on-charcoal, matching reference/theme.css and the reference mockups.

import {
  BULLET_R,
  COLOR,
  CORE_R,
  FIELD_H,
  FIELD_W,
  HALO_R,
  LIVES_X,
  LIVES_Y,
  MONO,
  SAUCER_R,
  SCORE_SIZE,
  SCORE_X,
  SCORE_Y,
  STAR_X,
  STAR_Y,
  TAU,
} from "./constants";
import { Game, OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./game";
import type { Bullet, EnemyBullet, Rock, Saucer, Vec } from "./types";

// The canvas 2D context, with the (widely-supported, sometimes untyped)
// letterSpacing property available.
type Ctx = CanvasRenderingContext2D & { letterSpacing: string };

// ---- Text --------------------------------------------------------------

interface TextOpts {
  size: number;
  color: string;
  weight?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  spacing?: number;
  glow?: string;
  glowBlur?: number;
  alpha?: number;
}

function setFont(ctx: Ctx, o: TextOpts): void {
  ctx.font = `${o.weight ?? 400} ${o.size}px ${MONO}`;
  ctx.textAlign = o.align ?? "center";
  ctx.textBaseline = o.baseline ?? "middle";
  ctx.letterSpacing = `${o.spacing ?? 0}px`;
}

// Centered text with letter-spacing gains a trailing gap after the last glyph,
// nudging the visual center right; compensate by half the spacing.
function centerShift(o: TextOpts): number {
  return (o.align ?? "center") === "center" ? (o.spacing ?? 0) / 2 : 0;
}

function drawText(ctx: Ctx, text: string, x: number, y: number, o: TextOpts): void {
  ctx.save();
  setFont(ctx, o);
  if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
  if (o.glow) {
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = o.glowBlur ?? 20;
  }
  ctx.fillStyle = o.color;
  ctx.fillText(text, x - centerShift(o), y);
  ctx.restore();
}

function measure(ctx: Ctx, text: string, o: TextOpts): number {
  ctx.save();
  setFont(ctx, o);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

// ---- Wrapped draw ------------------------------------------------------

// Draw a body at each torus offset where its circle (radius r) is on screen, so
// a shape straddling a wrap seam appears on both sides rather than popping.
function drawWrapped(
  x: number,
  y: number,
  r: number,
  draw: (px: number, py: number) => void,
): void {
  for (const ox of [-FIELD_W, 0, FIELD_W]) {
    for (const oy of [-FIELD_H, 0, FIELD_H]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > FIELD_W || py + r < 0 || py - r > FIELD_H) {
        continue;
      }
      draw(px, py);
    }
  }
}

// ---- Field furniture ---------------------------------------------------

function drawBackground(ctx: Ctx): void {
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  const g = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    0,
    STAR_X,
    STAR_Y,
    FIELD_W * 0.62,
  );
  g.addColorStop(0, "#0a1120");
  g.addColorStop(1, COLOR.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
}

function drawVignette(ctx: Ctx): void {
  const g = ctx.createRadialGradient(
    STAR_X,
    STAR_Y,
    FIELD_H * 0.42,
    STAR_X,
    STAR_Y,
    FIELD_H * 0.85,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

// The star: a bright solid core inside a softer radial halo fading outward, so
// the region of strongest pull reads at a glance (specs/overview.md, playfield).
function drawStar(ctx: Ctx, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(STAR_X, STAR_Y, 0, STAR_X, STAR_Y, HALO_R);
  g.addColorStop(0, COLOR.starCore);
  g.addColorStop(22 / HALO_R, COLOR.starCore);
  g.addColorStop(30 / HALO_R, "rgba(255, 180, 84, 0.85)");
  g.addColorStop(52 / HALO_R, "rgba(255, 123, 61, 0.5)");
  g.addColorStop(84 / HALO_R, "rgba(255, 123, 61, 0.22)");
  g.addColorStop(1, "rgba(255, 123, 61, 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, HALO_R, 0, TAU);
  ctx.fill();

  // The solid core, drawn crisply on top of the halo.
  ctx.shadowColor = "rgba(255, 180, 84, 0.9)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = COLOR.starCore;
  ctx.beginPath();
  ctx.arc(STAR_X, STAR_Y, CORE_R, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---- Bodies ------------------------------------------------------------

function drawRock(ctx: Ctx, rock: Rock, alpha = 1): void {
  const n = rock.verts.length;
  drawWrapped(rock.x, rock.y, rock.radius, (px, py) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = "rgba(154, 167, 189, 0.35)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rock.angle + (i / n) * TAU;
      const r = rock.verts[i];
      const vx = px + Math.cos(a) * r;
      const vy = py + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(154, 167, 189, 0.08)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLOR.rock;
    ctx.stroke();
    ctx.restore();
  });
}

// The ship triangle, drawn in a local frame whose nose points up (-y), rotated
// to the facing angle. `outline` draws just the hull outline (for life glyphs).
function shipPath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(13, 15);
  ctx.lineTo(0, 8);
  ctx.lineTo(-13, 15);
  ctx.closePath();
}

function drawShip(
  ctx: Ctx,
  x: number,
  y: number,
  angle: number,
  thrusting: boolean,
  alpha = 1,
): void {
  drawWrapped(x, y, 34, (px, py) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(angle + Math.PI / 2); // local nose-up frame -> facing angle

    if (thrusting) {
      const flick = 0.7 + Math.random() * 0.6;
      ctx.save();
      ctx.shadowColor = "rgba(255, 209, 102, 0.85)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = COLOR.thrust;
      ctx.beginPath();
      ctx.moveTo(-6, 15);
      ctx.lineTo(0, 15 + 17 * flick);
      ctx.lineTo(6, 15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLOR.thrustCore;
      ctx.beginPath();
      ctx.moveTo(-3, 15);
      ctx.lineTo(0, 15 + 9 * flick);
      ctx.lineTo(3, 15);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.shadowColor = "rgba(108, 240, 255, 0.75)";
    ctx.shadowBlur = 8;
    shipPath(ctx);
    ctx.fillStyle = "rgba(108, 240, 255, 0.12)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLOR.ship;
    ctx.stroke();
    ctx.restore();
  });
}

// A bullet's motion trail: a single tapering, fading comet tracing its recent
// (gravity-curved) path, so the bend near the star reads at a glance. Built as
// one filled ribbon whose half-width tapers to zero at the oldest end, filled
// with a head->tail gradient in the bullet color so it reads as a smooth streak
// rather than discrete dots. Because the samples span a fixed slice of time, the
// ribbon's length is proportional to the bullet's speed. The ribbon is cut at a
// wrap seam so it never smears across the field.
function drawTrail(ctx: Ctx, b: Bullet): void {
  // Newest -> oldest, stopping at a wrap seam: a jump larger than half the field
  // between samples means the bullet wrapped, so the trail ends there.
  const pts: Vec[] = [];
  for (let i = b.trail.length - 1; i >= 0; i--) {
    const p = b.trail[i];
    const prev = pts[pts.length - 1];
    if (
      prev &&
      (Math.abs(p.x - prev.x) > FIELD_W / 2 || Math.abs(p.y - prev.y) > FIELD_H / 2)
    ) {
      break;
    }
    pts.push(p);
  }
  if (pts.length < 2) return;

  const head = pts[0];
  const tail = pts[pts.length - 1];
  if (Math.hypot(head.x - tail.x, head.y - tail.y) < 2) return; // collapsed / at rest

  const n = pts.length;
  const headHalf = BULLET_R + 1.5;
  const left: Vec[] = [];
  const right: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(i - 1, 0)];
    const next = pts[Math.min(i + 1, n - 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Perpendicular to the local tangent, scaled by a half-width that tapers to 0.
    const nx = -ty;
    const ny = tx;
    const hw = headHalf * (1 - i / (n - 1)); // full at head, 0 at oldest end
    left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
    right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();

  const grad = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
  grad.addColorStop(0, "rgba(242, 245, 247, 0.5)");
  grad.addColorStop(0.55, "rgba(242, 245, 247, 0.16)");
  grad.addColorStop(1, "rgba(242, 245, 247, 0)");
  ctx.fillStyle = grad;
  ctx.shadowColor = "rgba(242, 245, 247, 0.3)";
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.restore();
}

function drawBullet(ctx: Ctx, b: Bullet): void {
  drawWrapped(b.x, b.y, BULLET_R + 4, (px, py) => {
    ctx.save();
    ctx.shadowColor = "rgba(242, 245, 247, 0.9)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = COLOR.bullet;
    ctx.beginPath();
    ctx.arc(px, py, BULLET_R, 0, TAU);
    ctx.fill();
    ctx.restore();
  });
}

function drawEnemyBullet(ctx: Ctx, b: EnemyBullet): void {
  drawWrapped(b.x, b.y, BULLET_R + 4, (px, py) => {
    ctx.save();
    ctx.shadowColor = "rgba(255, 92, 138, 0.9)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = COLOR.saucer;
    ctx.beginPath();
    ctx.arc(px, py, BULLET_R + 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  });
}

function drawSaucer(ctx: Ctx, s: Saucer): void {
  drawWrapped(s.x, s.y, SAUCER_R + 6, (px, py) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.shadowColor = "rgba(255, 92, 138, 0.7)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(-10, -8);
    ctx.lineTo(10, -8);
    ctx.lineTo(22, 0);
    ctx.lineTo(10, 8);
    ctx.lineTo(-10, 8);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 92, 138, 0.12)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLOR.saucer;
    ctx.stroke();
    // The dome.
    ctx.beginPath();
    ctx.moveTo(-10, -8);
    ctx.quadraticCurveTo(0, -19, 10, -8);
    ctx.stroke();
    ctx.restore();
  });
}

// ---- HUD ---------------------------------------------------------------

function shipGlyph(ctx: Ctx, x: number, y: number, scale: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  shipPath(ctx);
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.strokeStyle = COLOR.ship;
  ctx.stroke();
  ctx.restore();
}

function drawHud(ctx: Ctx, game: Game): void {
  drawText(ctx, `${game.score}`, SCORE_X, SCORE_Y, {
    size: SCORE_SIZE,
    weight: 700,
    color: COLOR.text,
    spacing: 3,
    align: "left",
    baseline: "top",
  });

  // Remaining lives: one glyph per ship in reserve (the ship in play is not).
  const reserve = Math.max(0, game.lives - 1);
  for (let i = 0; i < reserve; i++) {
    shipGlyph(ctx, LIVES_X + 16 + i * 42, LIVES_Y + 24, 0.7);
  }

  if (game.extraLifeTimer > 0) {
    drawText(ctx, "EXTRA SHIP", FIELD_W / 2, 150, {
      size: 22,
      color: COLOR.ship,
      spacing: 8,
      glow: "rgba(108, 240, 255, 0.5)",
      glowBlur: 14,
    });
  }
}

function drawWaveBanner(ctx: Ctx, game: Game): void {
  if (game.waveBannerTimer <= 0) return;
  drawText(ctx, `WAVE ${game.wave}`, FIELD_W / 2, FIELD_H / 2, {
    size: 64,
    weight: 700,
    color: COLOR.text,
    spacing: 12,
    glow: "rgba(255, 123, 61, 0.4)",
    glowBlur: 24,
  });
}

// ---- Menus & panels ----------------------------------------------------

function drawMenu(
  ctx: Ctx,
  items: string[],
  selected: number,
  centerX: number,
  startY: number,
  spacing: number,
  itemSize: number,
  letterSpacing: number,
): void {
  for (let i = 0; i < items.length; i++) {
    const y = startY + i * spacing;
    const isSel = i === selected;
    const opts: TextOpts = {
      size: itemSize,
      color: isSel ? COLOR.text : COLOR.textDim,
      spacing: letterSpacing,
      align: "center",
      baseline: "middle",
    };
    drawText(ctx, items[i], centerX, y, opts);
    if (isSel) {
      const w = measure(ctx, items[i], opts) - centerShift(opts);
      const markerOpts: TextOpts = {
        size: itemSize,
        color: COLOR.ship,
        align: "center",
        baseline: "middle",
        glow: "rgba(108, 240, 255, 0.6)",
        glowBlur: 12,
      };
      const gap = 28;
      drawText(ctx, "▸", centerX - w / 2 - gap, y, markerOpts);
      drawText(ctx, "◂", centerX + w / 2 + gap, y, markerOpts);
    }
  }
}

function drawPanel(ctx: Ctx, w: number, h: number): { x: number; y: number } {
  const x = FIELD_W / 2 - w / 2;
  const y = FIELD_H / 2 - h / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = COLOR.bgRaised;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 18);
  ctx.stroke();
  ctx.restore();
  return { x, y };
}

function roundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawOverlay(ctx: Ctx, opacity: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(4, 7, 12, ${opacity})`;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

// ---- Scenes ------------------------------------------------------------

// The live field: star, rocks, bullets, saucer, the ship, and the HUD.
function drawPlayScene(ctx: Ctx, game: Game): void {
  drawStar(ctx);
  for (const r of game.rocks) drawRock(ctx, r);
  for (const b of game.bullets) drawTrail(ctx, b);
  for (const b of game.bullets) drawBullet(ctx, b);
  for (const b of game.enemyBullets) drawEnemyBullet(ctx, b);
  if (game.saucer) drawSaucer(ctx, game.saucer);
  drawVignette(ctx);
  if (game.shipVisible()) {
    drawShip(ctx, game.ship.x, game.ship.y, game.ship.angle, game.thrusting);
  }
  drawHud(ctx, game);
  drawWaveBanner(ctx, game);
}

function drawTitle(ctx: Ctx, game: Game): void {
  // Dimmed field furniture behind the menu.
  drawStar(ctx, 0.32);
  for (const r of game.rocks) drawRock(ctx, r, 0.32);
  drawShip(ctx, game.ship.x, game.ship.y, game.ship.angle, false, 0.32);
  drawVignette(ctx);

  drawText(ctx, "SHATTER", FIELD_W / 2, 248, {
    size: 138,
    weight: 700,
    color: COLOR.ship,
    spacing: 26,
    glow: "rgba(108, 240, 255, 0.5)",
    glowBlur: 26,
  });
  drawText(ctx, "GRAVITY WELL SHOOTER", FIELD_W / 2, 330, {
    size: 22,
    color: COLOR.textDim,
    spacing: 13,
    glow: COLOR.bg,
    glowBlur: 12,
  });
  drawMenu(ctx, TITLE_ITEMS, game.menuIndex, FIELD_W / 2, 430, 52, 30, 10);

  const hint = game.audio.muted
    ? "▲ ▼ MOVE    ENTER SELECT    M UNMUTE"
    : "▲ ▼ MOVE    ENTER SELECT    M MUTE";
  drawText(ctx, hint, FIELD_W / 2, FIELD_H - 34, {
    size: 16,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawHowTo(ctx: Ctx): void {
  drawStar(ctx, 0.16);
  drawVignette(ctx);

  drawText(ctx, "HOW TO PLAY", FIELD_W / 2, 84, {
    size: 46,
    weight: 700,
    color: COLOR.ship,
    spacing: 10,
    glow: "rgba(108, 240, 255, 0.45)",
    glowBlur: 18,
  });

  const rows: Array<[string, string]> = [
    ["ROTATE", "Left / Right  or  A / D"],
    ["THRUST", "Up  or  W  —  you fly under momentum and coast"],
    ["FIRE", "Space  —  at most 4 shots live, rate-limited"],
    ["GRAVITY", "The star pulls your shots and the rocks — curve bullets"],
    ["", "around it. Your ship is powered and flies free of the pull."],
    ["SHATTER", "Large rocks split into Medium, Medium into Small,"],
    ["", "Small into nothing. Clear the field for the next wave."],
    ["STAR", "The core is solid but not lethal — the ship slides off it."],
    ["PAUSE", "Esc or P.    Mute with M."],
  ];
  let y = 168;
  for (let i = 0; i < rows.length; i++) {
    const [label, text] = rows[i];
    if (label) {
      drawText(ctx, label, 360, y, {
        size: 22,
        weight: 700,
        color: COLOR.starCore,
        spacing: 4,
        align: "right",
        baseline: "middle",
      });
    }
    drawText(ctx, text, 400, y, {
      size: 21,
      color: COLOR.text,
      spacing: 1,
      align: "left",
      baseline: "middle",
    });
    // A wrapped continuation line (the next row has no label) hugs the line
    // above it; a new entry gets the larger gap before it.
    const nextIsWrap = i + 1 < rows.length && !rows[i + 1][0];
    y += nextIsWrap ? 38 : 52;
  }

  drawText(ctx, "ESC / ENTER  —  BACK", FIELD_W / 2, FIELD_H - 44, {
    size: 18,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawPause(ctx: Ctx, game: Game): void {
  drawPlaySceneFrozen(ctx, game);
  drawOverlay(ctx, 0.72);

  const w = 560;
  const h = 400;
  const { y } = drawPanel(ctx, w, h);
  drawText(ctx, "PAUSED", FIELD_W / 2, y + 56, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
    baseline: "middle",
  });
  drawText(ctx, "SHATTER", FIELD_W / 2, y + 112, {
    size: 48,
    weight: 700,
    color: COLOR.ship,
    spacing: 8,
    glow: "rgba(108, 240, 255, 0.45)",
    glowBlur: 16,
    baseline: "middle",
  });
  drawMenu(ctx, PAUSE_ITEMS, game.menuIndex, FIELD_W / 2, y + 208, 52, 26, 6);
}

// The play scene without the flame flicker (used behind the pause overlay so it
// reads as frozen).
function drawPlaySceneFrozen(ctx: Ctx, game: Game): void {
  drawStar(ctx);
  for (const r of game.rocks) drawRock(ctx, r);
  for (const b of game.bullets) drawTrail(ctx, b);
  for (const b of game.bullets) drawBullet(ctx, b);
  for (const b of game.enemyBullets) drawEnemyBullet(ctx, b);
  if (game.saucer) drawSaucer(ctx, game.saucer);
  drawVignette(ctx);
  drawShip(ctx, game.ship.x, game.ship.y, game.ship.angle, false);
  drawHud(ctx, game);
}

function drawGameOver(ctx: Ctx, game: Game): void {
  // A dimmed, frozen final field behind the result panel.
  drawStar(ctx, 0.3);
  for (const r of game.rocks) drawRock(ctx, r, 0.3);
  drawVignette(ctx);
  drawOverlay(ctx, 0.72);

  const w = 580;
  const h = 440;
  const { y } = drawPanel(ctx, w, h);

  drawText(ctx, "SHATTER", FIELD_W / 2, y + 52, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
    baseline: "middle",
  });
  drawText(ctx, "GAME OVER", FIELD_W / 2, y + 116, {
    size: 56,
    weight: 700,
    color: COLOR.ship,
    spacing: 10,
    glow: "rgba(108, 240, 255, 0.5)",
    glowBlur: 20,
    baseline: "middle",
  });
  drawText(ctx, `SCORE ${game.score}`, FIELD_W / 2, y + 182, {
    size: 40,
    color: COLOR.text,
    spacing: 8,
    baseline: "middle",
  });
  drawText(ctx, `WAVE ${game.wave}`, FIELD_W / 2, y + 226, {
    size: 20,
    color: COLOR.textDim,
    spacing: 8,
    baseline: "middle",
  });
  drawMenu(ctx, OVER_ITEMS, game.menuIndex, FIELD_W / 2, y + 312, 52, 26, 6);
}

// ---- Entry point -------------------------------------------------------

export function render(ctx2d: CanvasRenderingContext2D, game: Game): void {
  const ctx = ctx2d as Ctx;
  drawBackground(ctx);

  switch (game.state) {
    case "title":
      drawTitle(ctx, game);
      break;
    case "howto":
      drawHowTo(ctx);
      break;
    case "playing":
      drawPlayScene(ctx, game);
      break;
    case "paused":
      drawPause(ctx, game);
      break;
    case "gameover":
      drawGameOver(ctx, game);
      break;
  }
}
