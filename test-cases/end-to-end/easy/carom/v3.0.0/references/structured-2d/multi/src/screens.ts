// Carom — the screen chrome: everything drawn OVER the field for whichever
// screen is up (specs/ui.md).
//
// Two actors, one per level. `TitleDisplay` draws the title level's screens —
// the title menu and the how-to-play page — over the dimmed furniture the
// level places. `MatchChrome` draws the match level's: the opening countdown
// digit, the pause panel, and the match-over panel, each over the live field.
// Both are single draw components on the top layer, reading their level's
// state at the moment the frame renders, so the chrome always shows the screen
// the frame's input left the game on.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi, RenderMode, World } from "@test-cabinet/structured-2d";
import { ballsOf } from "./ball";
import {
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  MATCHOVER_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
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
import { MatchState, TitleState } from "./state";
import { COLOR, LAYER, TAGLINE_TEXT } from "./theme";

const P1_GLOW = "rgba(58, 231, 196, 0.5)";

// ---- The title level's screens -------------------------------------------

export class TitleDisplay extends Actor {
  constructor() {
    super();
    this.attach(new TitleChrome()).layer = LAYER.chrome;
  }
}

class TitleChrome extends DrawComponent {
  draw(api: DrawApi): void {
    const state = this.actor.world.state;
    if (!(state instanceof TitleState)) return;
    const ctx = api.ctx as Ctx;
    if (state.screen === "howto") {
      drawHowTo(ctx, api.mode);
      return;
    }
    drawTitle(ctx, api.mode, state, this.actor.world.audio.muted());
  }
}

function drawTitle(
  ctx: Ctx,
  mode: RenderMode,
  state: TitleState,
  muted: boolean,
): void {
  // A posed decorative ball, off in the open field to the lower right so it
  // clears the title, the tagline, and the menu text. (The parked ball actors
  // themselves only join the picture once a match is up.)
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
  drawMenu(
    ctx,
    mode,
    TITLE_ITEMS,
    state.menuIndex,
    FIELD_CX,
    430,
    52,
    30,
    10,
    COLOR.p1,
  );

  const hint = muted
    ? "▲ ▼ MOVE    ENTER SELECT    M UNMUTE"
    : "▲ ▼ MOVE    ENTER SELECT    M MUTE";
  drawText(ctx, mode, hint, FIELD_CX, FIELD_H - 34, {
    size: 16,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

function drawHowTo(ctx: Ctx, mode: RenderMode): void {
  drawText(ctx, mode, "HOW TO PLAY", FIELD_CX, 96, {
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
    ["SPIN", "Swing your paddle as you strike to curve a ball."],
    ["", "Up and down swings curve it opposite ways; spin fades in ~2 s."],
    [
      "THREE BALLS",
      "Each launches, respawns, and scores on its own — and they collide.",
    ],
    [
      "OBSTACLES",
      "Two mid-field blocks bounce the balls — bank shots around them.",
    ],
    [
      "SCORE",
      "Send any ball past your opponent's edge. First to 11, win by 2.",
    ],
    ["PAUSE", "Esc or P.   Mute with M."],
  ];
  let y = 176;
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

  drawText(ctx, mode, "ESC / ENTER  —  BACK", FIELD_CX, FIELD_H - 44, {
    size: 18,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

// ---- The match level's screens -------------------------------------------

export class MatchChrome extends Actor {
  constructor() {
    super();
    this.attach(new MatchOverlays()).layer = LAYER.chrome;
  }
}

class MatchOverlays extends DrawComponent {
  draw(api: DrawApi): void {
    const state = this.actor.world.state;
    if (!(state instanceof MatchState)) return;
    const ctx = api.ctx as Ctx;

    switch (state.screen) {
      case "countdown":
        drawCountdown(ctx, api.mode, openingHold(this.actor.world));
        return;
      case "paused":
        drawPause(ctx, api.mode, state);
        return;
      case "matchover":
        drawMatchOver(ctx, api.mode, state);
        return;
      case "playing":
        return;
    }
  }
}

/**
 * The hold the countdown digit renders against. The holds are per ball
 * (specs/balls.md), and on the opening countdown all three share one, so this
 * is the longest of them — `0` once every ball is away.
 */
export function openingHold(world: World): number {
  return ballsOf(world).reduce(
    (max, ball) => (ball.held ? Math.max(max, ball.holdTimer) : max),
    0,
  );
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

function drawPause(ctx: Ctx, mode: RenderMode, state: MatchState): void {
  drawVeil(ctx, mode, FIELD_W, FIELD_H, 0.72);

  const { y } = drawPanel(ctx, mode, FIELD_CX, FIELD_CY, 520, 400);
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
  drawMenu(
    ctx,
    mode,
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

function drawMatchOver(ctx: Ctx, mode: RenderMode, state: MatchState): void {
  drawVeil(ctx, mode, FIELD_W, FIELD_H, 0.72);

  const { y } = drawPanel(ctx, mode, FIELD_CX, FIELD_CY, 560, 420);

  const winnerIsP1 = state.winner === "left";
  const winColor = winnerIsP1 ? COLOR.p1 : COLOR.p2;
  const winGlow = winnerIsP1 ? P1_GLOW : "rgba(255, 92, 138, 0.5)";
  let winnerText: string;
  if (state.game.mode === "solo") {
    winnerText = winnerIsP1 ? "YOU WIN" : "AI WINS";
  } else {
    winnerText = winnerIsP1 ? "PLAYER ONE WINS" : "PLAYER TWO WINS";
  }

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
  const [p1, p2] = state.players;
  drawText(
    ctx,
    mode,
    `${p1?.score ?? 0}  –  ${p2?.score ?? 0}`,
    FIELD_CX,
    y + 182,
    {
      size: 40,
      color: COLOR.text,
      spacing: 10,
    },
  );
  drawMenu(
    ctx,
    mode,
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
