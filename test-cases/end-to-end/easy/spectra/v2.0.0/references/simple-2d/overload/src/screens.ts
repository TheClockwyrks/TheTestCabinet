// Spectra — the seven screens, and what each one draws over the field
// (`specs/ui.md`).
//
// Every screen but the live wave lays a wash over the play field and draws its own
// copy on top of it, so the field stays visible behind a menu and a banner reads
// against whatever it interrupts. The copy each screen shows is the copy
// `src/constants.ts` names, drawn as its own text.

import {
  CHALLENGE_BANNER,
  CHALLENGE_TOTAL,
  FIELD_BOTTOM,
  FIELD_TOP,
  GAME_OVER_ITEMS,
  HUD_STAGE_LABEL,
  PAUSE_ITEMS,
  PERFECT_TEXT,
  READY_TEXT,
  SCORE_STAGE_CLEAR,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  isChallengeStage,
} from "./constants";
import { accent, drawMenu, label, scrim } from "./draw";
import { COLOR } from "./theme";
import type { SpectraState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** A wash over the whole play field. */
function wash(ctx: CanvasRenderingContext2D, color: string): void {
  scrim(ctx, color, FIELD_TOP, FIELD_BOTTOM);
}

/** The title screen: the game's name, its tagline, and the menu. */
function drawTitle(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  wash(ctx, COLOR.scrim);
  label(ctx, TITLE_TEXT, 640, 250, 92, COLOR.textBright, "center");
  label(ctx, TAGLINE_TEXT, 640, 296, 26, COLOR.accent, "center");
  // The two bands, side by side, so the pair reads before the first wave.
  accent(ctx, "cyan", 560, 340, 14, 3);
  accent(ctx, "magenta", 720, 340, 14, 3);
  drawMenu(ctx, TITLE_ITEMS, state.menuIndex, 430, 52, 32);
  label(ctx, "ENTER OR SPACE TO CHOOSE", 640, 600, 16, COLOR.textDim, "center");
}

/** How to play, in a player's words. */
const HOWTO_LINES: readonly string[] = [
  "Clear every wave of drones before your last life is spent.",
  "",
  "Your fighter is tuned to one band at a time, CYAN or MAGENTA.",
  "Only a shot of the band you hold destroys a drone, and that same",
  "band is your shield: enemy fire of your own band is absorbed.",
  "Flipping costs a beat of fire, so change on the right beat.",
  "",
  "A Shard keeps one band. A Flux swaps bands on a telegraphed",
  "rhythm and can be hit on neither while it shimmers. A Prism",
  "wears two layers, and inverts the whole field if it gets past you.",
  "",
  "Absorbing fire and matching kills fill the resonance meter.",
  "A full meter pays one discharge, which clears every diver.",
  "",
  "MOVE      ARROWS   or   AD",
  "FIRE      SPACE",
  "FLIP      F   or   SHIFT",
  "DISCHARGE X          PAUSE  P          MUTE  M",
];

function drawHowTo(ctx: CanvasRenderingContext2D): void {
  wash(ctx, COLOR.scrim);
  label(ctx, "HOW TO PLAY", 640, 130, 44, COLOR.textBright, "center");
  HOWTO_LINES.forEach((line, i) => {
    label(ctx, line, 200, 190 + i * 24, 18, COLOR.text);
  });
  label(ctx, "ESC TO GO BACK", 640, 632, 16, COLOR.textDim, "center");
}

/** The hold that announces the stage about to be played. */
function drawStageIntro(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  wash(ctx, COLOR.scrimLight);
  label(ctx, HUD_STAGE_LABEL, 640, 300, 40, COLOR.text, "center");
  label(ctx, String(state.stage), 640, 400, 96, COLOR.textBright, "center");
  if (isChallengeStage(state.stage)) {
    label(ctx, CHALLENGE_BANNER, 640, 470, 34, COLOR.accent, "center");
  }
}

/** The interstitial a finished stage opens, and the result it reports. */
function drawStageCleared(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  wash(ctx, COLOR.scrim);
  if (!isChallengeStage(state.stage)) {
    label(ctx, "STAGE CLEARED", 640, 320, 56, COLOR.textBright, "center");
    label(
      ctx,
      `BONUS ${SCORE_STAGE_CLEAR}`,
      640,
      390,
      30,
      COLOR.accent,
      "center",
    );
    return;
  }
  if (state.challengeHits >= CHALLENGE_TOTAL) {
    label(ctx, PERFECT_TEXT, 640, 320, 72, COLOR.accent, "center");
  } else {
    label(ctx, "CHALLENGE OVER", 640, 300, 44, COLOR.textBright, "center");
  }
  label(
    ctx,
    `${state.challengeHits} / ${CHALLENGE_TOTAL} DESTROYED`,
    640,
    390,
    30,
    COLOR.text,
    "center",
  );
}

/** The screen a lost run opens, reporting the run it ended. */
function drawGameOver(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  wash(ctx, COLOR.scrim);
  label(ctx, "GAME OVER", 640, 230, 68, COLOR.textBright, "center");
  label(ctx, "SCORE", 500, 300, 32, COLOR.textDim, "right");
  label(ctx, String(state.score), 520, 300, 32, COLOR.text);
  label(ctx, HUD_STAGE_LABEL, 500, 344, 26, COLOR.textDim, "right");
  label(ctx, String(state.stage), 520, 344, 26, COLOR.text);
  drawMenu(ctx, GAME_OVER_ITEMS, state.menuIndex, 440, 50, 30);
}

/** The pause menu, over the frozen field. */
function drawPaused(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  wash(ctx, COLOR.scrim);
  label(ctx, "PAUSED", 640, 250, 60, COLOR.textBright, "center");
  drawMenu(ctx, PAUSE_ITEMS, state.menuIndex, 350, 52, 30);
}

/** The banner the `ready` phase shows over the live field. */
function drawReady(ctx: CanvasRenderingContext2D): void {
  wash(ctx, COLOR.scrimLight);
  label(ctx, READY_TEXT, 640, 380, 64, COLOR.accent, "center");
}

/** Whatever the current screen draws over the field. */
export function drawScreen(
  ctx: CanvasRenderingContext2D,
  state: DeepReadonly<SpectraState>,
): void {
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state);
      return;
    case "howto":
      drawHowTo(ctx);
      return;
    case "stageIntro":
      drawStageIntro(ctx, state);
      return;
    case "stageCleared":
      drawStageCleared(ctx, state);
      return;
    case "paused":
      drawPaused(ctx, state);
      return;
    case "gameOver":
      drawGameOver(ctx, state);
      return;
    case "inWave":
      if (state.phase === "ready") drawReady(ctx);
      return;
  }
}

/** Whether the screen shows the live field behind it. */
export function showsField(
  screen: DeepReadonly<SpectraState>["screen"],
): boolean {
  return (
    screen === "inWave" ||
    screen === "paused" ||
    screen === "stageIntro" ||
    screen === "stageCleared"
  );
}
