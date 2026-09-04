// Kessler — the chrome of the six screens (specs/screens.md).
//
// The field itself is `src/render.ts`; this file is what each screen lays
// over it: the title and its menu, the how-to page in a player's words, the
// HUD hand-off on `playing`, the wave-clear banner, the pause overlay, and
// the game-over card. Every fixed piece of copy — `KESSLER`, `START`,
// `HOW TO PLAY`, `RESUME`, `QUIT`, `GAME OVER` — is drawn from the constants
// so it appears exactly as the specification states it; everything else is
// this build's own wording.

import { isReady } from "./assets";
import { POD_KINDS } from "./constants";
import {
  GAME_OVER_HEADING,
  GAME_TITLE,
  PAUSE_MENU,
  STAGE_SIZE,
  TITLE_MENU,
  WAVE_BONUS_PER_WAVE,
} from "./figures";
import { roundRect, text } from "./draw";
import type { View } from "./flow";
import { drawHud } from "./render";
import { COLORS } from "./theme";

type Ctx = CanvasRenderingContext2D;

const CX = STAGE_SIZE / 2;

/** Draw whatever the current screen lays over the field. */
export function drawScreenChrome(ctx: Ctx, state: View): void {
  switch (state.screen) {
    case "title":
      drawTitle(ctx, state);
      break;
    case "howto":
      drawHowto(ctx, state);
      break;
    case "playing":
      drawHud(ctx, state);
      break;
    case "waveclear":
      drawHud(ctx, state);
      drawWaveclear(ctx, state);
      break;
    case "paused":
      drawHud(ctx, state);
      drawPaused(ctx, state);
      break;
    case "gameover":
      drawGameover(ctx, state);
      break;
  }
}

function dim(ctx: Ctx, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.stage;
  ctx.fillRect(0, 0, STAGE_SIZE, STAGE_SIZE);
  ctx.restore();
}

/**
 * One menu, entries indexed from `0` at the top, the highlighted entry drawn
 * distinctly so a player always sees which entry `confirm` would accept.
 */
function drawMenu(
  ctx: Ctx,
  entries: readonly string[],
  index: number,
  top: number,
): void {
  entries.forEach((entry, i) => {
    const y = top + i * 56;
    const highlighted = i === index;
    text(ctx, entry, CX, y, {
      size: 26,
      color: highlighted ? COLORS.highlight : COLORS.textDim,
      bold: highlighted,
      align: "center",
      spacing: 6,
      glow: highlighted ? 16 : 0,
    });
    if (highlighted) {
      ctx.save();
      ctx.font = `bold 26px monospace`;
      const width = ctx.measureText(entry).width + entry.length * 6;
      ctx.fillStyle = COLORS.highlight;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(CX - width / 2, y + 12, width, 2.5);
      ctx.beginPath();
      ctx.moveTo(CX - width / 2 - 30, y - 9);
      ctx.lineTo(CX - width / 2 - 16, y - 2);
      ctx.lineTo(CX - width / 2 - 30, y + 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  });
}

function drawTitle(ctx: Ctx, state: View): void {
  dim(ctx, 0.74);
  text(ctx, GAME_TITLE, CX, 330, {
    size: 104,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 26,
    glow: 26,
    glowColor: COLORS.highlight,
  });
  text(ctx, "ORBITAL DEMOLITION", CX, 384, {
    size: 17,
    color: COLORS.textDim,
    align: "center",
    spacing: 10,
  });
  drawMenu(ctx, TITLE_MENU, state.menuIndex, 560);
  text(ctx, "W/S OR ARROWS - SELECT   ·   SPACE/ENTER - CONFIRM", CX, 730, {
    size: 13,
    color: COLORS.textFaint,
    align: "center",
    spacing: 2,
  });
}

function drawHowto(ctx: Ctx, state: View): void {
  dim(ctx, 0.82);
  ctx.save();
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, 140, 92, 720, 816, 14);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  text(ctx, "HOW TO PLAY", CX, 152, {
    size: 30,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 8,
  });

  const lines: (string | null)[] = [
    "You ride the deflector on a low track above the planet. Hold",
    "A / D (or the left and right arrows) to circle it either way, and",
    "press SPACE to launch the demolition ball outward.",
    null,
    "The ball comes back. Meet it with the deflector and where it",
    "lands on the arc steers the bounce - the edge throws it wide,",
    "the middle sends it straight. Miss, and the ball burns up on the",
    "planet; losing your last ball costs a life.",
    null,
    "Hitting a derelict scores. Sweep every one from the sky and the",
    "wave is cleared - the next one comes back faster and worth more.",
    null,
    "A breaking derelict may shed a salvage pod that falls toward the",
    "planet. Catch it on the deflector for a tool:",
  ];
  let y = 208;
  for (const line of lines) {
    if (line !== null) {
      text(ctx, line, 190, y, { size: 16, color: COLORS.textDim });
    }
    y += line === null ? 14 : 27;
  }

  // The five pods, by their own produced sprites.
  const names: Record<string, string> = {
    widen: "WIDEN",
    narrow: "NARROW",
    multiball: "MULTI",
    shield: "SHIELD",
    pierce: "PIERCE",
  };
  const start = CX - (POD_KINDS.length - 1) * 66;
  const podY = y + 26;
  for (let i = 0; i < POD_KINDS.length; i += 1) {
    const kind = POD_KINDS[i];
    const x = start + i * 132;
    const sprite = state.assets.pods[kind];
    if (isReady(sprite)) {
      ctx.drawImage(sprite, x - 18, podY - 18, 36, 36);
    } else {
      ctx.fillStyle = COLORS.pods[kind];
      ctx.beginPath();
      ctx.arc(x, podY, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    text(ctx, names[kind], x, podY + 40, {
      size: 12,
      color: COLORS.textFaint,
      align: "center",
      spacing: 1,
    });
  }
  y = podY + 76;

  text(ctx, "CONTROLS", 190, y + 8, {
    size: 14,
    color: COLORS.textFaint,
    spacing: 4,
  });
  const controls: [string, string][] = [
    ["ROTATE", "ArrowLeft / KeyA   and   ArrowRight / KeyD"],
    ["LAUNCH", "Space"],
    ["MENUS", "ArrowUp / KeyW, ArrowDown / KeyS - Space / Enter confirms"],
    ["PAUSE", "Escape or KeyP"],
  ];
  y += 38;
  for (const [label, keys] of controls) {
    text(ctx, label, 190, y, { size: 15, color: COLORS.text, bold: true });
    text(ctx, keys, 320, y, { size: 15, color: COLORS.textDim });
    y += 28;
  }

  text(ctx, "SPACE/ENTER OR ESC - BACK", CX, 872, {
    size: 13,
    color: COLORS.textFaint,
    align: "center",
    spacing: 3,
  });
}

function drawWaveclear(ctx: Ctx, state: View): void {
  const wave = state.session.wave;
  ctx.save();
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, 210, 386, 580, 208, 14);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  text(ctx, `WAVE ${wave} CLEAR`, CX, 462, {
    size: 44,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 10,
    glow: 18,
    glowColor: COLORS.highlight,
  });
  text(ctx, `+${WAVE_BONUS_PER_WAVE * wave} SALVAGE BONUS`, CX, 512, {
    size: 20,
    color: COLORS.highlight,
    align: "center",
    spacing: 4,
  });
  text(ctx, `WAVE ${wave + 1} INCOMING`, CX, 556, {
    size: 14,
    color: COLORS.textDim,
    align: "center",
    spacing: 4,
  });
}

function drawPaused(ctx: Ctx, state: View): void {
  dim(ctx, 0.6);
  ctx.save();
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, 300, 336, 400, 330, 14);
  ctx.fill();
  ctx.strokeStyle = COLORS.panelEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  text(ctx, "PAUSED", CX, 414, {
    size: 44,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 12,
  });
  drawMenu(ctx, PAUSE_MENU, state.menuIndex, 494);
  text(ctx, "ESC OR P - RESUME", CX, 626, {
    size: 13,
    color: COLORS.textFaint,
    align: "center",
    spacing: 3,
  });
}

function drawGameover(ctx: Ctx, state: View): void {
  dim(ctx, 0.8);
  text(ctx, GAME_OVER_HEADING, CX, 380, {
    size: 58,
    color: COLORS.text,
    bold: true,
    align: "center",
    spacing: 16,
    glow: 22,
    glowColor: "#ff5c5c",
  });
  text(ctx, "FINAL SCORE", CX, 460, {
    size: 15,
    color: COLORS.textFaint,
    align: "center",
    spacing: 5,
  });
  text(ctx, String(state.session.score), CX, 512, {
    size: 42,
    color: COLORS.text,
    bold: true,
    align: "center",
  });
  text(ctx, `WAVE REACHED  ${state.session.wave}`, CX, 560, {
    size: 17,
    color: COLORS.textDim,
    align: "center",
    spacing: 3,
  });
  text(ctx, "SPACE/ENTER - TITLE", CX, 660, {
    size: 13,
    color: COLORS.textFaint,
    align: "center",
    spacing: 3,
  });
}
