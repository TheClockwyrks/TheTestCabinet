// Carom — all rendering. Everything is drawn in logical 1280x720 space, and that
// is the whole story: the context the runtime hands `render` is already cleared to
// the background color and already carries the letterboxed, device-pixel-ratio
// aware transform for the fixed design size, so nothing here scales, translates,
// letterboxes, or looks at the canvas element. The look is neon-on-charcoal,
// matching the palette in specs/overview.md.
//
// Rendering is a pure read of `CaromState`: nothing below writes to it.

import {
  BALL_R,
  COLOR,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  MATCHOVER_ITEMS,
  MODE_LABEL,
  MONO,
  NET_X,
  OBSTACLES,
  PADDLE_HALF,
  PADDLE_W,
  PAUSE_ITEMS,
  SCORE_FONT_PX,
  SCORE_P1_X,
  SCORE_P2_X,
  SCORE_TOP_Y,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import { paddleBounds } from "./entities";
import type { BallState, CaromState } from "./game";
import { ribbon } from "./trail";

/**
 * The canvas 2D context, with the widely supported (and, in some lib versions,
 * untyped) `letterSpacing` property available.
 */
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

/**
 * Centered text with letter-spacing gains a trailing gap after the last glyph,
 * nudging the visual center right; compensate by half the spacing.
 */
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
  const x = NET_X - 2;
  for (let y = 24; y < FIELD_H - 24; y += 30) {
    ctx.fillRect(x, y, 4, 16);
  }
  ctx.restore();
}

function drawObstacles(ctx: Ctx): void {
  for (const o of OBSTACLES) {
    glowRect(
      ctx,
      o.x0,
      o.y0,
      o.x1 - o.x0,
      o.y1 - o.y0,
      6,
      COLOR.obstacle,
      "rgba(255, 180, 84, 0.5)",
      16,
    );
  }
}

function drawPaddles(ctx: Ctx, state: CaromState): void {
  glowRect(
    ctx,
    paddleBounds("left").x0,
    state.paddles.left.cy - PADDLE_HALF,
    PADDLE_W,
    PADDLE_HALF * 2,
    8,
    COLOR.p1,
    "rgba(58, 231, 196, 0.65)",
    18,
  );
  glowRect(
    ctx,
    paddleBounds("right").x0,
    state.paddles.right.cy - PADDLE_HALF,
    PADDLE_W,
    PADDLE_HALF * 2,
    8,
    COLOR.p2,
    "rgba(255, 92, 138, 0.65)",
    18,
  );
}

/**
 * The motion trail: a single tapering, fading comet following the ball's recent
 * (curving) path. It is built as one filled ribbon whose half-width tapers to zero
 * at the oldest end, filled with a head-to-tail gradient so it reads as a smooth
 * streak rather than as discrete dots. Its length is proportional to speed,
 * because the samples span a fixed slice of time.
 */
function drawTrail(ctx: Ctx, ball: BallState): void {
  // Newest first, and the newest sample IS where the ball is: the update records
  // each ball's position at the end of every frame, and the frame the runtime draws
  // is the frame it just updated. There is no interpolation to do — a variable
  // step means the renderer never draws between two simulation states.
  const pts = ribbon(ball.trail);
  if (pts.length < 2) return;

  const head = pts[0];
  const tail = pts[pts.length - 1];
  if (Math.hypot(head.x - tail.x, head.y - tail.y) < 3) return; // collapsed

  const n = pts.length;
  const headHalf = 8;
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
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
    const f = i / (n - 1); // 0 at the head, 1 at the tail
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

function drawBall(ctx: Ctx, x: number, y: number): void {
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
    FIELD_CX,
    FIELD_CY,
    FIELD_H * 0.35,
    FIELD_CX,
    FIELD_CY,
    FIELD_H * 0.75,
  );
  g.addColorStop(0, "rgba(0, 0, 0, 0)");
  g.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FIELD_W, FIELD_H);
  ctx.restore();
}

/**
 * The field furniture (net, obstacles, paddles). `alpha` dims it behind a menu
 * overlay. `includePaddles` can be turned off so the match scene can lift the
 * paddles above the vignette (see drawMatchScene) rather than let the vignette
 * darken them at the field edges where they live.
 */
function drawField(
  ctx: Ctx,
  state: CaromState,
  alpha = 1,
  includePaddles = true,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawNet(ctx);
  drawObstacles(ctx);
  if (includePaddles) drawPaddles(ctx, state);
  ctx.restore();
}

// ---- HUD ----------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function drawHud(ctx: Ctx, state: CaromState): void {
  const scoreOpts: TextOpts = {
    size: SCORE_FONT_PX,
    weight: 700,
    color: COLOR.text,
    spacing: 4,
    align: "center",
    baseline: "top",
  };
  drawText(ctx, pad2(state.score.p1), SCORE_P1_X, SCORE_TOP_Y, scoreOpts);
  drawText(ctx, pad2(state.score.p2), SCORE_P2_X, SCORE_TOP_Y, scoreOpts);

  drawText(ctx, MODE_LABEL[state.mode], 32, 28, {
    size: 18,
    color: COLOR.textFaint,
    spacing: 6,
    align: "left",
    baseline: "top",
  });
}

// ---- Menus --------------------------------------------------------------

/**
 * A vertical menu with a highlighted selection. The selected item is bright and
 * flanked by triangle markers in the accent color; the others are dim. Markers are
 * drawn beside the measured text so they never overlap it.
 */
function drawMenu(
  ctx: Ctx,
  items: readonly string[],
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
    if (!isSel) continue;
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

// ---- Screens ------------------------------------------------------------

function drawTitle(ctx: Ctx, state: CaromState): void {
  drawField(ctx, state, 0.28);
  // A posed decorative ball, off in the open field to the lower right so it clears
  // the title, the tagline, and the menu text.
  drawBall(ctx, 968, 470);
  drawVignette(ctx);

  drawText(ctx, TITLE_TEXT, FIELD_CX, 246, {
    size: 132,
    weight: 700,
    color: COLOR.p1,
    spacing: 22,
    glow: "rgba(58, 231, 196, 0.55)",
    glowBlur: 24,
  });
  drawText(ctx, TAGLINE_TEXT, FIELD_CX, 344, {
    size: 22,
    color: COLOR.textDim,
    spacing: 14,
  });
  drawMenu(
    ctx,
    TITLE_ITEMS,
    state.menuIndex,
    FIELD_CX,
    430,
    52,
    30,
    10,
    COLOR.p1,
  );

  const hint = state.muted
    ? "▲ ▼ MOVE    ENTER SELECT    M UNMUTE"
    : "▲ ▼ MOVE    ENTER SELECT    M MUTE";
  drawText(ctx, hint, FIELD_CX, FIELD_H - 34, {
    size: 16,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawHowTo(ctx: Ctx, state: CaromState): void {
  drawField(ctx, state, 0.16);
  drawVignette(ctx);

  drawText(ctx, "HOW TO PLAY", FIELD_CX, 96, {
    size: 46,
    weight: 700,
    color: COLOR.p1,
    spacing: 10,
    glow: "rgba(58, 231, 196, 0.45)",
    glowBlur: 18,
  });

  const rows: [string, string][] = [
    ["MOVE", "Solo: W / S  or  ↑ / ↓"],
    ["", "Versus: P1 uses W / S,  P2 uses ↑ / ↓"],
    ["SPIN", "Swing your paddle as you strike to curve the ball."],
    ["", "Up and down swings curve it opposite ways; spin fades in ~2 s."],
    [
      "OBSTACLES",
      "Two mid-field blocks bounce the ball — bank shots around them.",
    ],
    [
      "SCORE",
      "Send the ball past your opponent's edge. First to 11, win by 2.",
    ],
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

  drawText(ctx, "ESC / ENTER  —  BACK", FIELD_CX, FIELD_H - 44, {
    size: 18,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawMatchScene(ctx: Ctx, state: CaromState): void {
  // The net and the obstacles sit under the vignette (atmospheric edge
  // darkening); the ball, its trail, and the paddles are drawn on top of it so the
  // moving pieces keep full neon brightness everywhere on the field.
  drawField(ctx, state, 1, false);
  drawVignette(ctx);
  // Trails under every ball, so no ball's comet is drawn over another's body.
  for (const ball of state.balls) drawTrail(ctx, ball);
  for (const ball of state.balls) drawBall(ctx, ball.x, ball.y);
  drawPaddles(ctx, state);
  drawHud(ctx, state);
}

/**
 * What the opening countdown has left to run.
 *
 * The three balls share that hold, so this is the longest of them; every ball is
 * flying by the time it reaches zero and the countdown screen is behind us.
 */
export function holdRemaining(state: CaromState): number {
  let longest = 0;
  for (const ball of state.balls) {
    if (ball.holdTimer > longest) longest = ball.holdTimer;
  }
  return longest;
}

/** The countdown digit: a snappy 3-2-1 rendered across the HOLD_TIME hold. */
export function countdownNumber(holdTimer: number): number {
  return Math.min(3, Math.max(1, Math.ceil((holdTimer / HOLD_TIME) * 3)));
}

/** Progress `0..1` within the current countdown digit, for the pop animation. */
export function countdownPhase(holdTimer: number): number {
  const third = HOLD_TIME / 3;
  return (holdTimer % third) / third;
}

function drawCountdownOverlay(ctx: Ctx, state: CaromState): void {
  const remaining = holdRemaining(state);
  const num = countdownNumber(remaining);
  const phase = countdownPhase(remaining); // 1 -> 0 across each digit
  const pop = 0.7 + 0.3 * phase; // a gentle scale-in per digit
  const alpha = 0.35 + 0.65 * Math.min(1, phase * 1.6);

  ctx.save();
  ctx.translate(FIELD_CX, FIELD_CY + 10);
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

  drawText(ctx, "GET READY", FIELD_CX, FIELD_CY - 92, {
    size: 22,
    color: COLOR.textDim,
    spacing: 12,
  });
}

function drawPanel(ctx: Ctx, w: number, h: number): { x: number; y: number } {
  const x = FIELD_CX - w / 2;
  const y = FIELD_CY - h / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
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

function drawPause(ctx: Ctx, state: CaromState): void {
  drawMatchScene(ctx, state);
  drawOverlay(ctx, 0.72);

  const { y } = drawPanel(ctx, 520, 400);
  drawText(ctx, "PAUSED", FIELD_CX, y + 56, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
    baseline: "middle",
  });
  drawText(ctx, TITLE_TEXT, FIELD_CX, y + 110, {
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
    state.menuIndex,
    FIELD_CX,
    y + 200,
    52,
    26,
    6,
    COLOR.p1,
  );
}

function drawMatchOver(ctx: Ctx, state: CaromState): void {
  drawField(ctx, state, 0.32);
  drawVignette(ctx);
  drawOverlay(ctx, 0.72);

  const { y } = drawPanel(ctx, 560, 420);

  const winnerIsP1 = state.winner === "left";
  const winColor = winnerIsP1 ? COLOR.p1 : COLOR.p2;
  const winGlow = winnerIsP1
    ? "rgba(58, 231, 196, 0.5)"
    : "rgba(255, 92, 138, 0.5)";
  let winnerText: string;
  if (state.mode === "solo") {
    winnerText = winnerIsP1 ? "YOU WIN" : "AI WINS";
  } else {
    winnerText = winnerIsP1 ? "PLAYER ONE WINS" : "PLAYER TWO WINS";
  }

  drawText(ctx, "MATCH OVER", FIELD_CX, y + 52, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
    baseline: "middle",
  });
  drawText(ctx, winnerText, FIELD_CX, y + 116, {
    size: winnerText.length > 10 ? 44 : 52,
    weight: 700,
    color: winColor,
    spacing: 6,
    glow: winGlow,
    glowBlur: 18,
    baseline: "middle",
  });
  drawText(ctx, `${state.score.p1}  –  ${state.score.p2}`, FIELD_CX, y + 182, {
    size: 40,
    color: COLOR.text,
    spacing: 10,
    baseline: "middle",
  });
  drawMenu(
    ctx,
    MATCHOVER_ITEMS,
    state.menuIndex,
    FIELD_CX,
    y + 268,
    52,
    26,
    6,
    winColor,
  );
}

// ---- Entry point --------------------------------------------------------

/**
 * Draw one frame.
 *
 * The runtime clears the frame to the background color before calling this, so the
 * first thing drawn is the field furniture rather than a background fill.
 */
export function renderGame(
  state: CaromState,
  ctx2d: CanvasRenderingContext2D,
): void {
  const ctx = ctx2d as Ctx;

  switch (state.screen) {
    case "title":
      drawTitle(ctx, state);
      break;
    case "howto":
      drawHowTo(ctx, state);
      break;
    case "playing":
      drawMatchScene(ctx, state);
      break;
    case "countdown":
      drawMatchScene(ctx, state);
      drawCountdownOverlay(ctx, state);
      break;
    case "paused":
      drawPause(ctx, state);
      break;
    case "matchover":
      drawMatchOver(ctx, state);
      break;
  }
}
