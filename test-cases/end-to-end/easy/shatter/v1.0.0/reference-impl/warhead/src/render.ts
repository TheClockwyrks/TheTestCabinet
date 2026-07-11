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
  ROCK_HEALTH,
  SAUCER_R,
  SCORE_SIZE,
  SCORE_X,
  SCORE_Y,
  STAR_X,
  STAR_Y,
  TAU,
  TORP_X,
  TORP_Y,
  TORPEDO_COLOR,
} from "./constants";
import { Game, OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./game";
import type { Bullet, EnemyBullet, Rock, Saucer, Torpedo } from "./types";

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

// Linear interpolation between two #rrggbb hex colors, t in [0, 1].
function lerpHex(a: string, b: string, t: number): string {
  const pa = [
    parseInt(a.slice(1, 3), 16),
    parseInt(a.slice(3, 5), 16),
    parseInt(a.slice(5, 7), 16),
  ];
  const pb = [
    parseInt(b.slice(1, 3), 16),
    parseInt(b.slice(3, 5), 16),
    parseInt(b.slice(5, 7), 16),
  ];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// A rock, drawn with Warhead damage feedback: a full-health rock looks normal
// (cool grey); as its health falls it reads hotter, brighter, and cracked, and a
// fresh non-fatal hit flashes it white for HIT_FLASH_TIME.
function drawRock(ctx: Ctx, rock: Rock, alpha = 1): void {
  const n = rock.verts.length;
  const maxHp = ROCK_HEALTH[rock.size];
  const hitsTaken = maxHp - rock.hp;
  // Damage 0..1 across the hits a rock can survive (a Small has 1 hp, so it is
  // never seen damaged — the first hit destroys it).
  const dmg = maxHp > 1 ? Math.min(1, hitsTaken / (maxHp - 1)) : 0;
  const flashing = rock.hitFlash > 0;

  // Outline warms and brightens with damage; a hit flashes it near-white.
  const stroke = flashing
    ? "#ffffff"
    : dmg > 0
      ? lerpHex(COLOR.rock, "#f3f6fa", dmg)
      : COLOR.rock;
  const glowColor = dmg > 0 ? "rgba(255, 209, 102, 0.55)" : "rgba(154, 167, 189, 0.35)";
  const glowBlur = flashing ? 14 : 6 + dmg * 5;
  const fill =
    dmg > 0
      ? `rgba(255, 209, 102, ${0.06 + 0.08 * dmg})`
      : "rgba(154, 167, 189, 0.08)";

  drawWrapped(rock.x, rock.y, rock.radius, (px, py) => {
    // Precompute the outline vertices in world space (reused for the cracks).
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      const a = rock.angle + (i / n) * TAU;
      const r = rock.verts[i];
      pts.push([px + Math.cos(a) * r, py + Math.sin(a) * r]);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowBlur;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
      else ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2.5 + dmg;
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke;
    ctx.stroke();

    // Cracks: one jagged chord per hit taken, through a point near the center,
    // deterministic in the rock's frame so they stay put as it tumbles.
    if (hitsTaken > 0) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = flashing ? "#ffffff" : "#f3f6fa";
      ctx.lineWidth = 1.6;
      for (let k = 0; k < hitsTaken; k++) {
        const i0 = (k * 3 + 1) % n;
        const i1 = (i0 + Math.floor(n / 2)) % n;
        const off = rock.angle + k * 2.3;
        const cx = px + Math.cos(off) * rock.radius * 0.18;
        const cy = py + Math.sin(off) * rock.radius * 0.18;
        ctx.beginPath();
        ctx.moveTo(pts[i0][0], pts[i0][1]);
        ctx.lineTo(cx, cy);
        ctx.lineTo(pts[i1][0], pts[i1][1]);
        ctx.stroke();
      }
    }
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

// The torpedo: an elongated acid-green munition drawn along its heading, with a
// bright exhaust flame and a fading exhaust trail behind it, and a soft neon
// glow — so it reads at a glance as the heavy weapon, not a bullet.
function drawTorpedo(ctx: Ctx, t: Torpedo): void {
  drawWrapped(t.x, t.y, 60, (px, py) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(t.angle); // local +x points along the heading

    // Exhaust trail: a fading streak trailing behind the tail.
    const grad = ctx.createLinearGradient(-58, 0, -13, 0);
    grad.addColorStop(0, "rgba(184, 255, 92, 0)");
    grad.addColorStop(1, "rgba(184, 255, 92, 0.75)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-58, 0);
    ctx.lineTo(-13, 0);
    ctx.stroke();

    ctx.shadowColor = "rgba(184, 255, 92, 0.85)";
    ctx.shadowBlur = 8;

    // The exhaust flame at the tail.
    const flick = 0.7 + Math.random() * 0.6;
    ctx.fillStyle = "#eaffcf";
    ctx.beginPath();
    ctx.moveTo(-13, -4);
    ctx.lineTo(-13 - 12 * flick, 0);
    ctx.lineTo(-13, 4);
    ctx.closePath();
    ctx.fill();

    // The body: an elongated hull, nose forward (+x).
    ctx.beginPath();
    ctx.moveTo(-13, -5);
    ctx.lineTo(-5, -6);
    ctx.lineTo(10, -4);
    ctx.lineTo(17, 0);
    ctx.lineTo(10, 4);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-13, 5);
    ctx.closePath();
    ctx.fillStyle = "rgba(184, 255, 92, 0.18)";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeStyle = TORPEDO_COLOR;
    ctx.stroke();
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

  drawTorpedoHud(ctx, game);

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

// The torpedo-charge indicator below the lives row: a small torpedo glyph and a
// charge bar. When ready, the glyph is lit and the bar full; while recharging,
// the glyph is dimmed and the bar fills smoothly from empty to full across the
// 10-second recharge (specs/modes/warhead.md — HUD).
function drawTorpedoHud(ctx: Ctx, game: Game): void {
  const ready = game.torpedoCharged;
  const frac = Math.max(0, Math.min(1, game.torpedoChargeFrac()));
  const barX = TORP_X + 34;
  const barY = TORP_Y - 4;
  const barW = 66;
  const barH = 8;

  ctx.save();

  // The torpedo glyph — lit when ready, dimmed while recharging.
  ctx.save();
  ctx.translate(TORP_X + 14, TORP_Y);
  ctx.globalAlpha = ready ? 1 : 0.4;
  if (ready) {
    ctx.shadowColor = "rgba(184, 255, 92, 0.8)";
    ctx.shadowBlur = 6;
  }
  ctx.beginPath();
  ctx.moveTo(-9, -3);
  ctx.lineTo(-3, -4);
  ctx.lineTo(7, -3);
  ctx.lineTo(12, 0);
  ctx.lineTo(7, 3);
  ctx.lineTo(-3, 4);
  ctx.lineTo(-9, 3);
  ctx.closePath();
  ctx.fillStyle = "rgba(184, 255, 92, 0.22)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = TORPEDO_COLOR;
  ctx.stroke();
  // The exhaust flame at the tail.
  ctx.beginPath();
  ctx.moveTo(-9, -3);
  ctx.lineTo(-14, 0);
  ctx.lineTo(-9, 3);
  ctx.closePath();
  ctx.fillStyle = "#eaffcf";
  ctx.fill();
  ctx.restore();

  // The charge bar: a dim track with a fill proportional to the charge.
  roundRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = "rgba(184, 255, 92, 0.12)";
  ctx.fill();
  ctx.strokeStyle = "#3a4a2a";
  ctx.lineWidth = 1;
  ctx.stroke();
  if (frac > 0) {
    ctx.save();
    roundRect(ctx, barX, barY, Math.max(barH, barW * frac), barH, 4);
    ctx.clip();
    if (ready) {
      ctx.shadowColor = "rgba(184, 255, 92, 0.7)";
      ctx.shadowBlur = 5;
    }
    ctx.fillStyle = ready ? TORPEDO_COLOR : "rgba(184, 255, 92, 0.7)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.restore();
  }

  ctx.restore();
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
  for (const b of game.bullets) drawBullet(ctx, b);
  for (const b of game.enemyBullets) drawEnemyBullet(ctx, b);
  if (game.torpedo) drawTorpedo(ctx, game.torpedo);
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
    ["THRUST", "Up  or  W  —  fly under momentum; you coast when you let off"],
    ["FIRE", "Space  —  at most 4 shots live, rate-limited"],
    ["TORPEDO", "F  —  one guided torpedo on a 10s recharge. It homes onto"],
    ["", "the nearest target ahead and destroys any rock outright."],
    ["ARMOR", "Big rocks are armored — several hits to break; they crack"],
    ["", "as they weaken. A torpedo ignores armor and flies true."],
    ["GRAVITY", "The star curves your shots and the rocks — bend a bullet"],
    ["", "around it. Your ship is powered and flies free of the pull."],
    ["SHATTER", "Large → Medium → Small → gone. Clear the field to advance."],
    ["STAR", "The core is solid but not lethal — the ship slides off it."],
    ["PAUSE", "Esc or P.    Mute with M."],
  ];
  let y = 150;
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
    y += nextIsWrap ? 36 : 48;
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
  for (const b of game.bullets) drawBullet(ctx, b);
  for (const b of game.enemyBullets) drawEnemyBullet(ctx, b);
  if (game.torpedo) drawTorpedo(ctx, game.torpedo);
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
