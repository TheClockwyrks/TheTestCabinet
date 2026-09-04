// Carom — the screen chrome: everything drawn OVER the field for whichever
// screen is up (specs/ui.md).
//
// One actor, because one world hosts all six screens: `Chrome` reads the game
// state at the moment the frame renders and draws the title menu, the how-to
// page, the pre-serve countdown digit, the pause panel, or the match-over
// panel. Live play draws no chrome of its own — the HUD is its own actor
// (`src/hud.ts`).
//
// Every menu is drawn from the layout table in `src/menu.ts`, which is the same
// table the pointer hit-tests against and `menuItemRect` reports, so a player's
// eye, a finger, and a check all agree on where an item is.

import { Actor, DrawComponent } from "@test-cabinet/structured-2d";
import type { DrawApi, RenderMode } from "@test-cabinet/structured-2d";
import { ballOf } from "./ball";
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
import {
  HOWTO_MENU,
  MATCHOVER_MENU,
  MATCHOVER_PANEL,
  PAUSE_MENU,
  PAUSE_PANEL,
  TITLE_MENU,
} from "./menu";
import { caromState, type CaromState } from "./state";
import { COLOR, LAYER, TAGLINE_TEXT } from "./theme";

const P1_GLOW = "rgba(58, 231, 196, 0.5)";
const P2_GLOW = "rgba(255, 92, 138, 0.5)";

export class Chrome extends Actor {
  constructor() {
    super();
    this.attach(new ScreenOverlay()).layer = LAYER.chrome;
  }
}

class ScreenOverlay extends DrawComponent {
  draw(api: DrawApi): void {
    const world = this.actor.world;
    const state = caromState(world);
    const ctx = api.ctx as Ctx;

    switch (state.screen) {
      case "title":
        drawTitle(ctx, api.mode, state, world.audio.muted());
        return;
      case "howto":
        drawHowTo(ctx, api.mode);
        return;
      case "countdown":
        drawCountdown(ctx, api.mode, ballOf(world)?.holdTimer ?? 0);
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

// ---- The title -----------------------------------------------------------

function drawTitle(
  ctx: Ctx,
  mode: RenderMode,
  state: CaromState,
  muted: boolean,
): void {
  // A posed decorative ball, off in the open field to the lower right so it
  // clears the title, the tagline, and the menu text. (The ball actor itself
  // only joins the picture once a match is up.)
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
  drawMenu(ctx, mode, TITLE_MENU, state.menuIndex, COLOR.p1);

  const hint = muted
    ? "MOVE ▲ ▼ / CLICK    ENTER SELECT    M UNMUTE"
    : "MOVE ▲ ▼ / CLICK    ENTER SELECT    M MUTE";
  drawText(ctx, mode, hint, FIELD_CX, FIELD_H - 116, {
    size: 16,
    color: COLOR.textFaint,
    spacing: 8,
  });
}

// ---- How to play ---------------------------------------------------------

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
    ["PAUSE", "Esc or P.   Mute with M.   Menus take the mouse too."],
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

  // The how-to page shows a single item, index 0, drawn the way the other
  // menus draw the item at `menuIndex` (specs/ui.md).
  drawMenu(ctx, mode, HOWTO_MENU, 0, COLOR.p1);
}

// ---- The pre-serve countdown --------------------------------------------

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

// ---- The pause menu ------------------------------------------------------

function drawPause(ctx: Ctx, mode: RenderMode, state: CaromState): void {
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
  drawMenu(ctx, mode, PAUSE_MENU, state.menuIndex, COLOR.p1);
}

// ---- The match-over screen -----------------------------------------------

function drawMatchOver(ctx: Ctx, mode: RenderMode, state: CaromState): void {
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
  let winnerText: string;
  if (state.mode === "solo") {
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
  drawMenu(ctx, mode, MATCHOVER_MENU, state.menuIndex, winColor);
}
