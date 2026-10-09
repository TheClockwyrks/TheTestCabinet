// Carom — all rendering. Everything is drawn in logical 1280x720 space, and that
// is the whole story: the context the runtime hands `render` is already cleared to
// the background color and already carries the letterboxed, device-pixel-ratio
// aware transform for the fixed design size, so nothing here scales, translates,
// letterboxes, or looks at the canvas element. The look is neon-on-charcoal,
// this build's own palette in `src/theme.ts`; the geometry and the screen copy
// it draws are the specification's, from `src/constants.ts`.
//
// Rendering is a pure read of `CaromState`: nothing below writes to it.

import {
  BALL_R,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  NET_X,
  OBSTACLE_HH,
  OBSTACLE_HW,
  PADDLE_HALF,
  PADDLE_W,
  TITLE_TEXT,
} from "./constants";
import { paddleBounds } from "./entities";
import type { BallState, CaromState } from "./game";
import {
  MATCHOVER_PANEL,
  PAUSE_PANEL,
  menuLayout,
  panelTop,
  type MenuLayout,
} from "./menu";
import {
  COLOR,
  MODE_LABEL,
  MONO,
  SCORE_FONT_PX,
  SCORE_P1_X,
  SCORE_P2_X,
  SCORE_TOP_Y,
  TAGLINE_TEXT,
} from "./theme";
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

/**
 * Draw both obstacles at their live poses.
 *
 * Each is drawn in its OWN frame — translate to its center, rotate by its angle,
 * then draw the bar about the origin — so what the player sees is the same
 * oriented rectangle the collision in `src/physics.ts` resolves against, rather
 * than an upright bar that happens to sit in the same place.
 */
function drawObstacles(ctx: Ctx, state: CaromState): void {
  for (const o of state.obstacles) {
    ctx.save();
    ctx.translate(o.cx, o.cy);
    ctx.rotate(o.theta);
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
  // the ball's position at the end of every frame, and the frame the runtime draws
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

/**
 * The field furniture (net, obstacles, paddles, and the ball where there is one).
 * `alpha` dims it behind a menu overlay.
 *
 * An absent ball and an absent obstacle are simply not drawn, which is what
 * `specs/instrumentation.md` means by a body that takes no part in a frame.
 */
function drawField(ctx: Ctx, state: CaromState, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  drawNet(ctx);
  drawObstacles(ctx, state);
  drawPaddles(ctx, state);
  if (state.ball !== null) drawBall(ctx, state.ball.x, state.ball.y);
  ctx.restore();
}

// ---- HUD ----------------------------------------------------------------

function drawHud(ctx: Ctx, state: CaromState): void {
  const scoreOpts: TextOpts = {
    size: SCORE_FONT_PX,
    weight: 700,
    color: COLOR.text,
    spacing: 4,
    align: "center",
    baseline: "top",
  };
  drawText(ctx, String(state.score.p1), SCORE_P1_X, SCORE_TOP_Y, scoreOpts);
  drawText(ctx, String(state.score.p2), SCORE_P2_X, SCORE_TOP_Y, scoreOpts);

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
 *
 * The captions land at the centers of the very regions `src/menu.ts` reports
 * through `menuItemRect`, because both come from the same layout — which is what
 * makes a pointer aimed at a reported region land on the word a player can see.
 */
function drawMenu(
  ctx: Ctx,
  layout: MenuLayout,
  selected: number,
  accent: string,
): void {
  for (let i = 0; i < layout.items.length; i++) {
    const y = layout.startY + i * layout.spacing;
    const isSel = i === selected;
    const opts: TextOpts = {
      size: layout.fontPx,
      color: isSel ? COLOR.text : COLOR.textDim,
      spacing: layout.letterSpacing,
      align: "center",
      baseline: "middle",
    };
    drawText(ctx, layout.items[i], layout.centerX, y, opts);
    if (!isSel) continue;
    const w = measure(ctx, layout.items[i], opts) - centerShift(opts);
    const markerOpts: TextOpts = {
      size: layout.fontPx,
      color: accent,
      align: "center",
      baseline: "middle",
      glow: accent,
      glowBlur: 12,
    };
    const gap = 26;
    drawText(ctx, "▸", layout.centerX - w / 2 - gap, y, markerOpts);
    drawText(ctx, "◂", layout.centerX + w / 2 + gap, y, markerOpts);
  }
}

/** The menu the screen shows, drawn at `selected`. A screen with none draws none. */
function drawScreenMenu(ctx: Ctx, state: CaromState, accent: string): void {
  const layout = menuLayout(state.screen);
  if (layout !== null) drawMenu(ctx, layout, state.menuIndex, accent);
}

// ---- Screens ------------------------------------------------------------

function drawTitle(ctx: Ctx, state: CaromState): void {
  drawField(ctx, state, 0.28);

  drawText(ctx, TITLE_TEXT, FIELD_CX, 246, {
    size: 132,
    weight: 700,
    color: COLOR.p1,
    spacing: 22,
    glow: "rgba(58, 231, 196, 0.55)",
    glowBlur: 24,
  });
  drawText(ctx, TAGLINE_TEXT, FIELD_CX, 322, {
    size: 22,
    color: COLOR.textDim,
    spacing: 14,
  });
  drawScreenMenu(ctx, state, COLOR.p1);

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
      "Two mid-field blocks sway and spin — read the tilt to bank your shot.",
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

  drawText(ctx, "ESC OR ENTER", FIELD_CX, FIELD_H - 92, {
    size: 16,
    color: COLOR.textFaint,
    spacing: 8,
  });
  drawScreenMenu(ctx, state, COLOR.p1);
}

function drawMatchScene(ctx: Ctx, state: CaromState): void {
  // The field is one flat color out to its edges, so the letterbox bars the
  // runtime clears to the same color continue it seamlessly (specs/overview.md).
  drawNet(ctx);
  drawObstacles(ctx, state);
  drawPaddles(ctx, state);
  if (state.ball !== null) {
    drawTrail(ctx, state.ball);
    drawBall(ctx, state.ball.x, state.ball.y);
  }
  drawHud(ctx, state);
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
  const holdTimer = state.ball?.holdTimer ?? 0;
  const num = countdownNumber(holdTimer);
  const phase = countdownPhase(holdTimer); // 1 -> 0 across each digit
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
  // The same top edge `src/menu.ts` lays the panel's menu out from, so the two
  // cannot drift apart.
  const y = panelTop(h);
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

  const { y } = drawPanel(ctx, PAUSE_PANEL.w, PAUSE_PANEL.h);
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
  drawScreenMenu(ctx, state, COLOR.p1);
}

function drawMatchOver(ctx: Ctx, state: CaromState): void {
  drawField(ctx, state, 0.32);
  drawOverlay(ctx, 0.72);

  const { y } = drawPanel(ctx, MATCHOVER_PANEL.w, MATCHOVER_PANEL.h);

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
  drawScreenMenu(ctx, state, winColor);
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
