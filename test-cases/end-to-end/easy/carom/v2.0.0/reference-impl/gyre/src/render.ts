// Carom — all rendering. Everything is drawn in logical 1280x720 space; main.ts
// sets the canvas transform so this scales to the window. The look is
// neon-on-charcoal, matching the palette in specs/overview.md.

import {
  COLOR,
  FIELD_H,
  FIELD_W,
  MONO,
  OBSTACLE_HH,
  OBSTACLE_HW,
  PADDLE_HALF,
  PADDLE_W,
  BALL_R,
  SCORE_P1_X,
  SCORE_P2_X,
  SCORE_TOP_Y,
} from "./constants";
import type { Game } from "./game";
import { OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "./game";
import { OBSTACLE_COUNT, obstaclePose } from "./obstacles";

// The canvas 2D context, with the (widely-supported, sometimes untyped)
// letterSpacing property available.
type Ctx = CanvasRenderingContext2D & { letterSpacing: string };

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

function drawText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  o: TextOpts,
): void {
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

function roundRectPath(
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

function glowRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  glow: string,
  blur: number,
): void {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

// ---- Field furniture ----------------------------------------------------

function drawNet(ctx: Ctx): void {
  ctx.save();
  ctx.fillStyle = COLOR.net;
  const x = 638;
  for (let y = 24; y < 696; y += 30) {
    ctx.fillRect(x, y, 4, 16);
  }
  ctx.restore();
}

// Each obstacle is drawn rotated and shifted to its current pose (from the
// obstacle clock), so the rendered bar matches the oriented shape the collision
// resolves against.
function drawObstacles(ctx: Ctx, game: Game): void {
  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    const p = obstaclePose(i, game.obsTime);
    ctx.save();
    ctx.translate(p.cx, p.cy);
    ctx.rotate(p.theta);
    glowRect(
      ctx,
      -OBSTACLE_HW,
      -OBSTACLE_HH,
      OBSTACLE_HW * 2,
      OBSTACLE_HH * 2,
      6,
      COLOR.obstacle,
      "rgba(255, 180, 84, 0.5)",
      16,
    );
    ctx.restore();
  }
}

function drawPaddles(ctx: Ctx, game: Game): void {
  glowRect(
    ctx,
    game.left.x0,
    game.left.cy - PADDLE_HALF,
    PADDLE_W,
    PADDLE_HALF * 2,
    8,
    COLOR.p1,
    "rgba(58, 231, 196, 0.65)",
    18,
  );
  glowRect(
    ctx,
    game.right.x0,
    game.right.cy - PADDLE_HALF,
    PADDLE_W,
    PADDLE_HALF * 2,
    8,
    COLOR.p2,
    "rgba(255, 92, 138, 0.65)",
    18,
  );
}

// The motion trail: a single tapering, fading comet following the ball's recent
// (curving) path. Built as one filled ribbon whose half-width tapers to zero at
// the oldest end, filled with a head->tail gradient so it reads as a smooth
// streak rather than discrete dots. Length is proportional to speed because the
// samples span a fixed slice of time.
function drawTrail(ctx: Ctx, game: Game): void {
  const pts = game.trail.ribbon(game.simTime);
  if (pts.length < 2) return;

  const head = pts[0];
  const tail = pts[pts.length - 1];
  const totalLen = Math.hypot(head.x - tail.x, head.y - tail.y);
  if (totalLen < 3) return; // collapsed (e.g. during the pre-serve hold)

  const n = pts.length;
  const headHalf = 8;
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const prev = pts[Math.max(i - 1, 0)];
    const next = pts[Math.min(i + 1, n - 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    // Perpendicular to the local tangent.
    const nx = -ty;
    const ny = tx;
    const f = i / (n - 1); // 0 at head, 1 at tail
    const hw = headHalf * (1 - f);
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
  grad.addColorStop(0, "rgba(242, 245, 247, 0.55)");
  grad.addColorStop(0.55, "rgba(242, 245, 247, 0.18)");
  grad.addColorStop(1, "rgba(242, 245, 247, 0)");
  ctx.fillStyle = grad;
  ctx.shadowColor = "rgba(242, 245, 247, 0.35)";
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.restore();
}

function drawBall(
  ctx: Ctx,
  game: Game,
  x = game.ball.x,
  y = game.ball.y,
): void {
  ctx.save();
  ctx.shadowColor = "rgba(242, 245, 247, 0.8)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = COLOR.ball;
  ctx.beginPath();
  ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawVignette(ctx: Ctx): void {
  const g = ctx.createRadialGradient(
    FIELD_W / 2,
    FIELD_H / 2,
    FIELD_H * 0.35,
    FIELD_W / 2,
    FIELD_H / 2,
    FIELD_H * 0.75,
  );
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

// The full field furniture (net, obstacles, paddles). `alpha` dims it behind a
// menu overlay. `includePaddles` can be turned off so the match scene can lift
// the paddles above the vignette (see drawMatchScene) rather than let the
// vignette darken them at the field edges where they live.
function drawField(
  ctx: Ctx,
  game: Game,
  alpha = 1,
  includePaddles = true,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawNet(ctx);
  drawObstacles(ctx, game);
  if (includePaddles) drawPaddles(ctx, game);
  ctx.restore();
}

// ---- HUD ----------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function drawHud(ctx: Ctx, game: Game): void {
  const scoreOpts: TextOpts = {
    size: 76,
    weight: 700,
    color: COLOR.text,
    spacing: 4,
    align: "center",
    baseline: "top",
  };
  drawText(ctx, pad2(game.scoreP1), SCORE_P1_X, SCORE_TOP_Y, scoreOpts);
  drawText(ctx, pad2(game.scoreP2), SCORE_P2_X, SCORE_TOP_Y, scoreOpts);

  const label = game.mode === "solo" ? "SOLO" : "VERSUS";
  drawText(ctx, label, 32, 28, {
    size: 18,
    color: COLOR.textFaint,
    spacing: 6,
    align: "left",
    baseline: "top",
  });
}

// ---- Menus --------------------------------------------------------------

// A vertical menu with a highlighted selection. The selected item is bright and
// flanked by triangle markers in the accent color; others are dim. Markers are
// drawn beside the measured text so they never overlap it.
function drawMenu(
  ctx: Ctx,
  items: string[],
  selected: number,
  centerX: number,
  startY: number,
  spacing: number,
  itemSize: number,
  letterSpacing: number,
  accent: string,
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
        color: accent,
        align: "center",
        baseline: "middle",
        glow: accent,
        glowBlur: 12,
      };
      const gap = 26;
      drawText(ctx, "▸", centerX - w / 2 - gap, y, markerOpts);
      drawText(ctx, "◂", centerX + w / 2 + gap, y, markerOpts);
    }
  }
}

// ---- Screens ------------------------------------------------------------

function drawTitle(ctx: Ctx, game: Game): void {
  drawField(ctx, game, 0.28);
  // A posed decorative ball, off in the open field to the lower right so it
  // clears the title, subtitle, and menu text (it previously sat dead-center
  // over the "NEON PADDLE DUEL" subtitle and made it hard to read).
  drawBall(ctx, game, 968, 470);
  drawVignette(ctx);

  drawText(ctx, "CAROM", FIELD_W / 2, 246, {
    size: 132,
    weight: 700,
    color: COLOR.p1,
    spacing: 22,
    glow: "rgba(58, 231, 196, 0.55)",
    glowBlur: 24,
  });
  drawText(ctx, "NEON PADDLE DUEL", FIELD_W / 2, 344, {
    size: 22,
    color: COLOR.textDim,
    spacing: 14,
  });
  drawMenu(
    ctx,
    TITLE_ITEMS,
    game.menuIndex,
    FIELD_W / 2,
    430,
    52,
    30,
    10,
    COLOR.p1,
  );

  const hint = game.audio.muted ? "▲ ▼ MOVE    ENTER SELECT    M UNMUTE" : "▲ ▼ MOVE    ENTER SELECT    M MUTE";
  drawText(ctx, hint, FIELD_W / 2, FIELD_H - 34, {
    size: 16,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawHowTo(ctx: Ctx, game: Game): void {
  drawField(ctx, game, 0.16);
  drawVignette(ctx);

  drawText(ctx, "HOW TO PLAY", FIELD_W / 2, 96, {
    size: 46,
    weight: 700,
    color: COLOR.p1,
    spacing: 10,
    glow: "rgba(58, 231, 196, 0.45)",
    glowBlur: 18,
  });

  const rows: Array<[string, string]> = [
    ["MOVE", "Solo: W / S  or  ↑ / ↓"],
    ["", "Versus: P1 uses W / S,  P2 uses ↑ / ↓"],
    ["SPIN", "Swing your paddle as you strike to curve the ball."],
    ["", "Up and down swings curve it opposite ways; spin fades in ~2 s."],
    ["OBSTACLES", "Two mid-field blocks sway and spin — bank off their tilted faces."],
    ["SCORE", "Send the ball past your opponent's edge. First to 11, win by 2."],
    ["PAUSE", "Esc or P.   Mute with M."],
  ];
  let y = 190;
  for (const [label, text] of rows) {
    if (label) {
      drawText(ctx, label, 300, y, {
        size: 22,
        weight: 700,
        color: COLOR.obstacle,
        spacing: 4,
        align: "right",
        baseline: "middle",
      });
    }
    drawText(ctx, text, 340, y, {
      size: 22,
      color: label ? COLOR.text : COLOR.textDim,
      spacing: 1,
      align: "left",
      baseline: "middle",
    });
    y += label ? 58 : 40;
  }

  drawText(ctx, "ESC / ENTER  —  BACK", FIELD_W / 2, FIELD_H - 44, {
    size: 18,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawMatchScene(ctx: Ctx, game: Game): void {
  // Net and obstacles sit under the vignette (atmospheric edge darkening); the
  // ball, its trail, and the paddles are drawn on top of it so the moving
  // pieces keep full neon brightness everywhere on the field. Under the
  // vignette the ball dimmed as it crossed toward the edges — reading as a
  // brightness pulse — and the edge-hugging paddles looked permanently muted.
  drawField(ctx, game, 1, false);
  drawVignette(ctx);
  drawTrail(ctx, game);
  drawBall(ctx, game);
  drawPaddles(ctx, game);
  drawHud(ctx, game);
}

function drawCountdownOverlay(ctx: Ctx, game: Game): void {
  const num = game.countdownNumber();
  const phase = game.countdownPhase(); // 1 -> 0 across each digit
  const pop = 0.7 + 0.3 * phase; // gentle scale-in per digit
  const alpha = 0.35 + 0.65 * Math.min(1, phase * 1.6);

  ctx.save();
  ctx.translate(FIELD_W / 2, FIELD_H / 2 + 10);
  ctx.scale(pop, pop);
  drawText(ctx, `${num}`, 0, 0, {
    size: 150,
    weight: 700,
    color: COLOR.text,
    spacing: 0,
    glow: "rgba(58, 231, 196, 0.5)",
    glowBlur: 30,
    alpha,
  });
  ctx.restore();

  drawText(ctx, "GET READY", FIELD_W / 2, FIELD_H / 2 - 92, {
    size: 22,
    color: COLOR.textDim,
    spacing: 12,
  });
}

function drawPanel(
  ctx: Ctx,
  w: number,
  h: number,
): { x: number; y: number } {
  const x = FIELD_W / 2 - w / 2;
  const y = FIELD_H / 2 - h / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = COLOR.bgRaised;
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, w, h, 18);
  ctx.stroke();
  ctx.restore();
  return { x, y };
}

function drawOverlay(ctx: Ctx, opacity: number): void {
  ctx.save();
  ctx.fillStyle = `rgba(7, 9, 14, ${opacity})`;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

function drawPause(ctx: Ctx, game: Game): void {
  drawMatchScene(ctx, game);
  drawOverlay(ctx, 0.72);

  const w = 520;
  const h = 400;
  const { y } = drawPanel(ctx, w, h);
  drawText(ctx, "PAUSED", FIELD_W / 2, y + 56, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
    baseline: "middle",
  });
  drawText(ctx, "CAROM", FIELD_W / 2, y + 110, {
    size: 48,
    weight: 700,
    color: COLOR.p1,
    spacing: 8,
    glow: "rgba(58, 231, 196, 0.45)",
    glowBlur: 16,
    baseline: "middle",
  });
  drawMenu(
    ctx,
    PAUSE_ITEMS,
    game.menuIndex,
    FIELD_W / 2,
    y + 200,
    52,
    26,
    6,
    COLOR.p1,
  );
}

function drawMatchOver(ctx: Ctx, game: Game): void {
  drawField(ctx, game, 0.32);
  drawVignette(ctx);
  drawOverlay(ctx, 0.72);

  const w = 560;
  const h = 420;
  const { y } = drawPanel(ctx, w, h);

  const winnerIsP1 = game.winner === "left";
  const winColor = winnerIsP1 ? COLOR.p1 : COLOR.p2;
  const winGlow = winnerIsP1
    ? "rgba(58, 231, 196, 0.5)"
    : "rgba(255, 92, 138, 0.5)";
  let winnerText: string;
  if (game.mode === "solo") {
    winnerText = winnerIsP1 ? "YOU WIN" : "AI WINS";
  } else {
    winnerText = winnerIsP1 ? "PLAYER ONE WINS" : "PLAYER TWO WINS";
  }

  drawText(ctx, "MATCH OVER", FIELD_W / 2, y + 52, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
    baseline: "middle",
  });
  drawText(ctx, winnerText, FIELD_W / 2, y + 116, {
    size: winnerText.length > 10 ? 44 : 52,
    weight: 700,
    color: winColor,
    spacing: 6,
    glow: winGlow,
    glowBlur: 18,
    baseline: "middle",
  });
  drawText(
    ctx,
    `${game.scoreP1}  –  ${game.scoreP2}`,
    FIELD_W / 2,
    y + 182,
    {
      size: 40,
      color: COLOR.text,
      spacing: 10,
      baseline: "middle",
    },
  );
  drawMenu(
    ctx,
    OVER_ITEMS,
    game.menuIndex,
    FIELD_W / 2,
    y + 268,
    52,
    26,
    6,
    winColor,
  );
}

// ---- Debug overlay ------------------------------------------------------

// A read-only diagnostic layer over the running game: the live internal state
// (screen, mode, scores, each ball's and paddle's position/velocity/speed/spin, and
// each obstacle's center and rotation). Toggled with the backtick key (see
// game.handleInput); off by default; draws only — never changes gameplay. See
// specs/instrumentation.md.
function drawDebugOverlay(ctx: Ctx, game: Game): void {
  const s = game.debugSnapshot();
  const lines: string[] = [];
  lines.push(`screen  ${s.screen}   mode ${s.mode}`);
  lines.push(
    `score   ${s.score.p1} - ${s.score.p2}${s.winner ? `   winner ${s.winner}` : ""}`,
  );
  lines.push(`simTime ${s.simTime.toFixed(2)}s`);
  lines.push(
    `padL    cy ${s.paddles.left.cy.toFixed(0)}  vy ${s.paddles.left.vy.toFixed(0)}`,
  );
  lines.push(
    `padR    cy ${s.paddles.right.cy.toFixed(0)}  vy ${s.paddles.right.vy.toFixed(0)}`,
  );
  s.balls.forEach((b, i) => {
    lines.push(
      `ball${i}   x ${b.x.toFixed(0)} y ${b.y.toFixed(0)}  v ${b.vx.toFixed(0)},${b.vy.toFixed(0)}`,
    );
    lines.push(
      `        spd ${b.speed.toFixed(0)}  spin ${b.spin.toFixed(0)}${b.held ? "  held" : ""}`,
    );
  });
  s.obstacles.forEach((o, i) => {
    const deg = ((o.theta * 180) / Math.PI) % 360;
    lines.push(
      `obs${i}    c ${o.cx.toFixed(0)},${o.cy.toFixed(0)}  rot ${deg.toFixed(0)}deg`,
    );
  });

  const pad = 14;
  const headerH = 24;
  const lineH = 20;
  const w = 340;
  const x = 24;
  const y = 92; // below the top-left mode label
  const h = pad * 2 + headerH + lines.length * lineH;

  ctx.save();
  ctx.fillStyle = "rgba(7, 9, 14, 0.82)";
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, w, h, 8);
  ctx.stroke();
  ctx.restore();

  drawText(ctx, "DEBUG", x + pad, y + pad, {
    size: 12,
    weight: 700,
    color: COLOR.obstacle,
    spacing: 4,
    align: "left",
    baseline: "top",
  });

  let ly = y + pad + headerH;
  for (const line of lines) {
    drawText(ctx, line, x + pad, ly, {
      size: 15,
      color: COLOR.textDim,
      align: "left",
      baseline: "top",
    });
    ly += lineH;
  }
}

// ---- Entry point --------------------------------------------------------

export function render(ctx2d: CanvasRenderingContext2D, game: Game): void {
  const ctx = ctx2d as Ctx;
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);

  switch (game.state) {
    case "title":
      drawTitle(ctx, game);
      break;
    case "howto":
      drawHowTo(ctx, game);
      break;
    case "playing":
      drawMatchScene(ctx, game);
      break;
    case "countdown":
      drawMatchScene(ctx, game);
      drawCountdownOverlay(ctx, game);
      break;
    case "paused":
      drawPause(ctx, game);
      break;
    case "matchover":
      drawMatchOver(ctx, game);
      break;
  }

  if (game.debugOverlay) drawDebugOverlay(ctx, game);
}
