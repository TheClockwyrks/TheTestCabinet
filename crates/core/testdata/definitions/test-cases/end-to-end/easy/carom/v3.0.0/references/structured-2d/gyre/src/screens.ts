// Carom — the screen chrome: everything drawn OVER the field for whichever
// screen is up (specs/ui.md).
//
// One actor, placed by both levels, because one game state carries the screen
// on both (src/state.ts): the title menu and the how-to page, the pre-serve
// countdown digit, the pause panel, and the match-over panel are six cases of
// one switch, read at the moment the frame renders, so the chrome always shows
// the screen the frame's input left the game on.
//
// Every menu is drawn from the layout `src/menus.ts` fixes and nowhere else, so
// the region a pointer selects an item from (`menuItemRect`) and the place that
// item is drawn cannot drift apart.

import { Actor, DrawComponent } from "@clockwyrks/structured-2d";
import type { DrawApi, RenderMode } from "@clockwyrks/structured-2d";
import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  TITLE_TEXT,
} from "./constants";
import {
  drawMenu,
  drawPanel,
  drawText,
  drawVeil,
  glowCircle,
  type Ctx,
} from "./draw";
import { ballOf } from "./field";
import {
  MATCHOVER_PANEL,
  PAUSE_PANEL,
  menuLayout,
  type MenuLayout,
} from "./menus";
import { caromState, type CaromState } from "./state";
import { COLOR, LAYER, TAGLINE_TEXT } from "./theme";

const P1_GLOW = "rgba(58, 231, 196, 0.5)";
const P2_GLOW = "rgba(255, 92, 138, 0.5)";

/** The chrome over the field, on whichever level and whichever screen. */
export class Chrome extends Actor {
  constructor() {
    super();
    this.attach(new ScreenOverlays()).layer = LAYER.chrome;
  }
}

class ScreenOverlays extends DrawComponent {
  draw(api: DrawApi): void {
    const state = caromState(this.actor.world);
    const ctx = api.ctx as Ctx;
    const layout = menuLayout(state.screen);

    switch (state.screen) {
      case "title":
        drawTitle(ctx, api.mode, state, layout, this.actor.world.audio.muted());
        return;
      case "howto":
        drawHowTo(ctx, api.mode, layout);
        return;
      case "countdown":
        drawCountdown(ctx, api.mode, this.holdTimer());
        return;
      case "paused":
        drawPause(ctx, api.mode, state, layout);
        return;
      case "matchover":
        drawMatchOver(ctx, api.mode, state, layout);
        return;
      case "playing":
        return;
    }
  }

  /** Seconds left of the pre-serve hold, or none while there is no ball. */
  private holdTimer(): number {
    return ballOf(this.actor.world)?.holdTimer ?? 0;
  }
}

// ---- The title level's screens -------------------------------------------

function drawTitle(
  ctx: Ctx,
  mode: RenderMode,
  state: CaromState,
  layout: MenuLayout | null,
  muted: boolean,
): void {
  // A posed decorative ball, off in the open field to the lower right so it
  // clears the title, the tagline, and the menu text.
  glowCircle(
    ctx,
    mode,
    968,
    470,
    11,
    COLOR.ball,
    "rgba(242, 245, 247, 0.8)",
    16,
  );

  drawText(ctx, mode, TITLE_TEXT, FIELD_CX, 246, {
    size: 132,
    weight: 700,
    color: COLOR.p1,
    spacing: 22,
    glow: "rgba(58, 231, 196, 0.55)",
    glowBlur: 24,
  });
  drawText(ctx, mode, TAGLINE_TEXT, FIELD_CX, 344, {
    size: 22,
    color: COLOR.textDim,
    spacing: 14,
  });
  if (layout !== null) {
    drawMenu(ctx, mode, layout, state.menuIndex, COLOR.p1);
  }

  const hint = muted
    ? "▲ ▼ MOVE    ENTER SELECT    M UNMUTE"
    : "▲ ▼ MOVE    ENTER SELECT    M MUTE";
  drawText(ctx, mode, hint, FIELD_CX, FIELD_H - 96, {
    size: 16,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawHowTo(
  ctx: Ctx,
  mode: RenderMode,
  layout: MenuLayout | null,
): void {
  drawText(ctx, mode, "HOW TO PLAY", FIELD_CX, 88, {
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
  let y = 178;
  for (const [label, text] of rows) {
    if (label) {
      drawText(ctx, mode, label, 300, y, {
        size: 22,
        weight: 700,
        color: COLOR.obstacle,
        spacing: 4,
        align: "right",
        baseline: "middle",
      });
    }
    drawText(ctx, mode, text, 340, y, {
      size: 22,
      color: label ? COLOR.text : COLOR.textDim,
      spacing: 1,
      align: "left",
      baseline: "middle",
    });
    y += label ? 56 : 38;
  }

  // The page's one menu item, drawn the way the other menus draw the item at
  // `menuIndex` — because it is one (specs/ui.md).
  if (layout !== null) drawMenu(ctx, mode, layout, 0, COLOR.p1);
}

// ---- The match level's screens -------------------------------------------

/** The countdown digit: a snappy 3-2-1 rendered across the HOLD_TIME hold. */
export function countdownNumber(holdTimer: number): number {
  return Math.min(3, Math.max(1, Math.ceil((holdTimer / HOLD_TIME) * 3)));
}

/** Progress `0..1` within the current countdown digit, for the pop animation. */
export function countdownPhase(holdTimer: number): number {
  const third = HOLD_TIME / 3;
  return (holdTimer % third) / third;
}

function drawCountdown(ctx: Ctx, mode: RenderMode, holdTimer: number): void {
  const num = countdownNumber(holdTimer);
  const phase = countdownPhase(holdTimer); // 1 -> 0 across each digit
  const pop = 0.7 + 0.3 * phase; // a gentle scale-in per digit
  const alpha = 0.35 + 0.65 * Math.min(1, phase * 1.6);

  ctx.save();
  ctx.translate(FIELD_CX, FIELD_CY + 10);
  ctx.scale(pop, pop);
  drawText(ctx, mode, `${num}`, 0, 0, {
    size: 150,
    weight: 700,
    color: COLOR.text,
    spacing: 0,
    glow: P1_GLOW,
    glowBlur: 30,
    alpha,
  });
  ctx.restore();

  drawText(ctx, mode, "GET READY", FIELD_CX, FIELD_CY - 92, {
    size: 22,
    color: COLOR.textDim,
    spacing: 12,
  });
}

function drawPause(
  ctx: Ctx,
  mode: RenderMode,
  state: CaromState,
  layout: MenuLayout | null,
): void {
  drawVeil(ctx, mode, FIELD_W, FIELD_H, 0.72);

  const { y } = drawPanel(
    ctx,
    mode,
    FIELD_CX,
    FIELD_CY,
    PAUSE_PANEL.w,
    PAUSE_PANEL.h,
  );
  drawText(ctx, mode, "PAUSED", FIELD_CX, y + 56, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
  });
  drawText(ctx, mode, TITLE_TEXT, FIELD_CX, y + 110, {
    size: 48,
    weight: 700,
    color: COLOR.p1,
    spacing: 8,
    glow: "rgba(58, 231, 196, 0.45)",
    glowBlur: 16,
  });
  if (layout !== null) {
    drawMenu(ctx, mode, layout, state.menuIndex, COLOR.p1);
  }
}

function drawMatchOver(
  ctx: Ctx,
  mode: RenderMode,
  state: CaromState,
  layout: MenuLayout | null,
): void {
  drawVeil(ctx, mode, FIELD_W, FIELD_H, 0.72);

  const { y } = drawPanel(
    ctx,
    mode,
    FIELD_CX,
    FIELD_CY,
    MATCHOVER_PANEL.w,
    MATCHOVER_PANEL.h,
  );

  const winnerIsP1 = state.winner === "left";
  const winColor = winnerIsP1 ? COLOR.p1 : COLOR.p2;
  const winGlow = winnerIsP1 ? P1_GLOW : P2_GLOW;
  const winnerText =
    state.game.mode === "solo"
      ? winnerIsP1
        ? "YOU WIN"
        : "AI WINS"
      : winnerIsP1
        ? "PLAYER ONE WINS"
        : "PLAYER TWO WINS";

  drawText(ctx, mode, "MATCH OVER", FIELD_CX, y + 52, {
    size: 18,
    color: COLOR.textDim,
    spacing: 10,
  });
  drawText(ctx, mode, winnerText, FIELD_CX, y + 116, {
    size: winnerText.length > 10 ? 44 : 52,
    weight: 700,
    color: winColor,
    spacing: 6,
    glow: winGlow,
    glowBlur: 18,
  });
  drawText(
    ctx,
    mode,
    `${state.score.p1}  –  ${state.score.p2}`,
    FIELD_CX,
    y + 182,
    { size: 40, color: COLOR.text, spacing: 10 },
  );
  if (layout !== null) {
    drawMenu(ctx, mode, layout, state.menuIndex, winColor);
  }
}
