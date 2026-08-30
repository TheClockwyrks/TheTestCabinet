// Wireworm — all canvas drawing, in world units on the 1280x720 stage.
//
// Everything here is a pure read of the state it is handed: nothing advances or
// stores anything. The functions run inside the draw components in
// `src/stage.ts`, whose context arrives cleared and already carrying the
// world-to-device transform — and the game leaves the camera at rest, so world
// units and the stage's logical units coincide and no code below reads the
// canvas element's size.
//
// The look is this build's own (`src/theme.ts`). What it must deliver is
// legibility (`specs/overview.md`): the four charge states told apart as a ramp,
// the worm apart from the board and from a node, the cursor apart from its band,
// the three foes apart from one another, a bolt apart from the column it climbs,
// the band as a floor across the full width, and every piece of text readable at
// the stage size.
//
// The nodes, the worm, the cursor and the three foes are drawn from the seeded
// art under `assets/` (`specs/assets.md`), each frame centered on the entity's
// own center, and each element falls back to a shape in its own color where a
// frame did not arrive. Everything else — the board, the band, a bolt, the arcs,
// the HUD, the screens and the banner — is drawn in code.

import {
  ARC_LIFE,
  BAND_TOP_Y,
  BOARD_H,
  BOARD_Y,
  COLS,
  CORRUPTOR_FPS,
  CURSOR_HALF,
  ENDING_ITEMS,
  HUD_H,
  HUD_LEVEL_LABEL,
  GLITCH_FPS,
  NODE_PULSE_FPS,
  PAUSE_ITEMS,
  ROWS,
  SPRITE_SIZE,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
  TOTAL_LEVELS,
  WORM_BODY_FPS,
  WORM_HEAD_FPS,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import type { Screen, Tile, WirewormState } from "./game";
import { random } from "./rng";
import { art, type Frame } from "./sprites";
import { CHARGE_GLOW, COLOR, digits, font, withAlpha } from "./theme";

type Ctx = CanvasRenderingContext2D;

const HALF = SPRITE_SIZE / 2;

/** Whether the board itself is shown behind whatever screen is up. */
export function boardVisible(screen: Screen): boolean {
  return (
    screen === "playing" ||
    screen === "paused" ||
    screen === "victory" ||
    screen === "gameover"
  );
}

/** One frame from a folder, centered on `(cx, cy)`, mirrored where asked. */
function drawFrame(
  ctx: Ctx,
  frame: Frame,
  cx: number,
  cy: number,
  mirrored = false,
): boolean {
  if (frame === null) return false;
  if (!mirrored) {
    ctx.drawImage(frame, cx - HALF, cy - HALF, SPRITE_SIZE, SPRITE_SIZE);
    return true;
  }
  // The art faces right, so a leftward worm or corruptor is the same frame under
  // a negative horizontal scale (`specs/assets.md`).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(-1, 1);
  ctx.drawImage(frame, -HALF, -HALF, SPRITE_SIZE, SPRITE_SIZE);
  ctx.restore();
  return true;
}

// ---- The board ------------------------------------------------------------

/** The substrate, its trace grid, the player band, and the HUD bar behind it. */
export function renderGround(state: WirewormState, ctx: Ctx): void {
  ctx.fillStyle = COLOR.board;
  ctx.fillRect(0, BOARD_Y, STAGE_W, BOARD_H);

  // The etched traces, one line per tile edge, so the grid reads without
  // competing with anything standing on it.
  ctx.strokeStyle = COLOR.trace;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < COLS; c += 1) {
    ctx.moveTo(tileLeft(c) + 0.5, BOARD_Y);
    ctx.lineTo(tileLeft(c) + 0.5, STAGE_H);
  }
  for (let r = 1; r < ROWS; r += 1) {
    ctx.moveTo(0, tileTop(r) + 0.5);
    ctx.lineTo(STAGE_W, tileTop(r) + 0.5);
  }
  ctx.stroke();

  // The player band: a floor across the full width, with a lit lip along its top
  // edge so it reads as one.
  ctx.fillStyle = COLOR.band;
  ctx.fillRect(0, BAND_TOP_Y, STAGE_W, STAGE_H - BAND_TOP_Y);
  ctx.fillStyle = withAlpha(COLOR.bandEdge, 0.85);
  ctx.fillRect(0, BAND_TOP_Y - 2, STAGE_W, 3);
  ctx.fillStyle = withAlpha(COLOR.bandEdge, 0.12);
  ctx.fillRect(0, BAND_TOP_Y, STAGE_W, 10);

  // The HUD bar's own ground. It is the board's ground layer that paints it, and
  // every layer of play above is clipped to the board region (`src/stage.ts`),
  // so nothing standing on the board reaches the bar (`specs/board.md`).
  ctx.fillStyle = COLOR.hudBar;
  ctx.fillRect(0, 0, STAGE_W, HUD_H);
  ctx.fillStyle = withAlpha(COLOR.hudRule, 0.9);
  ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);

  if (!boardVisible(state.screen)) {
    // Title and how-to: the board is a quiet backdrop rather than a scene.
    ctx.fillStyle = withAlpha(COLOR.void, 0.55);
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
}

// ---- The node field -------------------------------------------------------

/** The frame a node of `charge` is drawn at, pulsing while it is critical. */
export function nodeFrame(charge: number, time: number): number {
  if (charge < 3) return charge;
  return 3 + (Math.floor(time * NODE_PULSE_FPS) % 2);
}

export function renderNodes(state: WirewormState, ctx: Ctx): void {
  if (!boardVisible(state.screen)) return;
  const frames = art().node;
  for (const node of state.nodes) {
    const cx = tileCX(node.c);
    const cy = tileCY(node.r);
    const glow = CHARGE_GLOW[Math.min(CHARGE_GLOW.length - 1, node.charge)];
    if (glow.radius > 0) {
      // The charge ramp, in light: brighter and wider at every step, with
      // critical the most so (`specs/overview.md`).
      const pulse =
        node.charge >= 3
          ? 0.82 + 0.18 * Math.sin(state.simTime * NODE_PULSE_FPS * Math.PI)
          : 1;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, glow.radius);
      halo.addColorStop(0, withAlpha(glow.color, glow.alpha * pulse));
      halo.addColorStop(1, withAlpha(glow.color, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(
        cx - glow.radius,
        cy - glow.radius,
        glow.radius * 2,
        glow.radius * 2,
      );
    }
    const drawn = drawFrame(
      ctx,
      frames[nodeFrame(node.charge, state.simTime)],
      cx,
      cy,
    );
    if (drawn) continue;
    ctx.fillStyle = COLOR.nodeFallback[Math.min(3, node.charge)];
    ctx.fillRect(cx - 11, cy - 11, 22, 22);
  }
}

// ---- The worms ------------------------------------------------------------

/** The frame a segment is drawn at: the head pair, the body pair, or the tail pair. */
export function segmentFrame(
  index: number,
  length: number,
  time: number,
): number {
  if (index === 0) return Math.floor(time * WORM_HEAD_FPS) % 2;
  const alternate = Math.floor(time * WORM_BODY_FPS) % 2;
  if (index === length - 1) return 4 + alternate;
  return 2 + alternate;
}

export function renderWorms(state: WirewormState, ctx: Ctx): void {
  if (!boardVisible(state.screen)) return;
  const frames = art().worm;
  for (const worm of state.worms) {
    const length = worm.segments.length;
    for (let index = 0; index < length; index += 1) {
      const segment = worm.segments[index];
      const cx = tileCX(segment.c);
      const cy = tileCY(segment.r);
      const frame = frames[segmentFrame(index, length, state.simTime)];
      if (drawFrame(ctx, frame, cx, cy, worm.dh < 0)) continue;
      ctx.fillStyle =
        index === 0
          ? COLOR.wormHead
          : index === length - 1
            ? COLOR.wormTail
            : COLOR.wormBody;
      ctx.fillRect(cx - 13, cy - 13, 26, 26);
    }
  }
}

// ---- The foes -------------------------------------------------------------

export function renderFoes(state: WirewormState, ctx: Ctx): void {
  if (!boardVisible(state.screen)) return;
  const sheets = art();
  for (const foe of state.foes) {
    if (foe.kind === "glitch") {
      const frame = sheets.glitch[Math.floor(state.simTime * GLITCH_FPS) % 4];
      if (drawFrame(ctx, frame, foe.x, foe.y)) continue;
      ctx.fillStyle = COLOR.glitchFallback;
      ctx.fillRect(foe.x - 12, foe.y - 12, 24, 24);
      continue;
    }
    if (foe.kind === "dropper") {
      if (drawFrame(ctx, sheets.dropper[0], foe.x, foe.y)) continue;
      ctx.fillStyle = COLOR.dropperFallback;
      ctx.beginPath();
      ctx.moveTo(foe.x, foe.y + 12);
      ctx.lineTo(foe.x - 12, foe.y - 10);
      ctx.lineTo(foe.x + 12, foe.y - 10);
      ctx.closePath();
      ctx.fill();
      continue;
    }
    const frame =
      sheets.corruptor[Math.floor(state.simTime * CORRUPTOR_FPS) % 4];
    if (drawFrame(ctx, frame, foe.x, foe.y, foe.vx < 0)) continue;
    ctx.fillStyle = COLOR.corruptorFallback;
    ctx.beginPath();
    ctx.ellipse(foe.x, foe.y, 13, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---- The bolts, the cursor and the arcs -----------------------------------

export function renderBolts(state: WirewormState, ctx: Ctx): void {
  if (!boardVisible(state.screen)) return;
  for (const bolt of state.bolts) {
    const glow = ctx.createLinearGradient(
      bolt.x,
      bolt.y - 14,
      bolt.x,
      bolt.y + 6,
    );
    glow.addColorStop(0, withAlpha(COLOR.bolt, 0));
    glow.addColorStop(0.5, withAlpha(COLOR.bolt, 0.9));
    glow.addColorStop(1, withAlpha(COLOR.bolt, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(bolt.x - 4, bolt.y - 14, 8, 20);
    ctx.fillStyle = COLOR.bolt;
    ctx.fillRect(bolt.x - 1.5, bolt.y - 10, 3, 14);
  }
}

export function renderCursor(state: WirewormState, ctx: Ctx): void {
  if (!boardVisible(state.screen)) return;
  const { cursor } = state;
  // The spawn-in invulnerability reads as a pulse rather than a blink, so the
  // cursor is never off the screen while a player is holding it.
  ctx.globalAlpha =
    cursor.invulnerable > 0
      ? 0.55 + 0.45 * Math.abs(Math.sin(state.simTime * 9))
      : 1;
  const halo = ctx.createRadialGradient(
    cursor.x,
    cursor.y,
    0,
    cursor.x,
    cursor.y,
    22,
  );
  halo.addColorStop(0, withAlpha(COLOR.accent, 0.35));
  halo.addColorStop(1, withAlpha(COLOR.accent, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(cursor.x - 22, cursor.y - 22, 44, 44);
  if (!drawFrame(ctx, art().cursor[0], cursor.x, cursor.y)) {
    ctx.fillStyle = COLOR.cursorFallback;
    ctx.beginPath();
    ctx.moveTo(cursor.x, cursor.y - CURSOR_HALF);
    ctx.lineTo(cursor.x + CURSOR_HALF, cursor.y + CURSOR_HALF);
    ctx.lineTo(cursor.x - CURSOR_HALF, cursor.y + CURSOR_HALF);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * The lightning one arc is drawn as: a jagged polyline joining the centers of
 * the two tiles it links. Its shape is FIXED when the arc is created and holds
 * for the arc's life (`specs/discharge.md`), which is why the jitter is drawn
 * from a generator seeded on the pair of tiles rather than re-drawn each frame:
 * the same link is the same bolt for as long as it lasts, and a recorded
 * discharge stays small.
 */
export function arcPolyline(from: Tile, to: Tile): { x: number; y: number }[] {
  const ax = tileCX(from.c);
  const ay = tileCY(from.r);
  const bx = tileCX(to.c);
  const by = tileCY(to.r);
  const seed =
    ((from.c * 73856093) ^
      (from.r * 19349663) ^
      (to.c * 83492791) ^
      (to.r * 2654435761)) |
    0;
  const source = { rngState: seed };
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const points = [{ x: ax, y: ay }];
  const steps = 4;
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const offset = (random(source) - 0.5) * Math.min(14, length * 0.35);
    points.push({ x: ax + dx * t + nx * offset, y: ay + dy * t + ny * offset });
  }
  points.push({ x: bx, y: by });
  return points;
}

export function renderArcs(state: WirewormState, ctx: Ctx): void {
  if (!boardVisible(state.screen)) return;
  for (const arc of state.arcs) {
    const life = Math.max(0, Math.min(1, arc.life / ARC_LIFE));
    const points = arcPolyline(arc.from, arc.to);
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = withAlpha(COLOR.arcGlow, 0.55 * life);
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = withAlpha(COLOR.arc, life);
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

// ---- The HUD and the screens ----------------------------------------------

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  face: string,
  fill: string,
  align: CanvasTextAlign = "center",
): void {
  ctx.font = face;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

/** The three readouts, all of them inside the HUD bar (`specs/ui.md`). */
function renderHud(state: WirewormState, ctx: Ctx): void {
  text(ctx, "SCORE", 28, 22, font(13), COLOR.textDim, "left");
  text(ctx, String(state.score), 28, 52, digits(34), COLOR.text, "left");

  text(ctx, "LIVES", 470, 22, font(13), COLOR.textDim, "left");
  const shown = Math.min(8, Math.max(0, state.lives));
  for (let index = 0; index < shown; index += 1) {
    const x = 474 + index * 26;
    ctx.fillStyle = COLOR.accent;
    ctx.beginPath();
    ctx.moveTo(x + 9, 40);
    ctx.lineTo(x + 18, 60);
    ctx.lineTo(x, 60);
    ctx.closePath();
    ctx.fill();
  }
  if (state.lives > 8) {
    text(
      ctx,
      `x${state.lives}`,
      474 + 8 * 26,
      52,
      font(18),
      COLOR.text,
      "left",
    );
  }

  text(ctx, HUD_LEVEL_LABEL, 1252, 22, font(13), COLOR.textDim, "right");
  text(
    ctx,
    `${state.level} / ${TOTAL_LEVELS}`,
    1252,
    52,
    digits(30),
    COLOR.text,
    "right",
  );
}

/** A dim sheet over the board, which every menu screen sits on. */
function scrim(ctx: Ctx): void {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

/** A vertical menu, its highlighted item drawn distinctly from the others. */
function renderMenu(
  ctx: Ctx,
  items: readonly string[],
  selected: number,
  top: number,
): void {
  items.forEach((item, index) => {
    const y = top + index * 46;
    const on = index === selected;
    if (on) {
      ctx.fillStyle = withAlpha(COLOR.accent, 0.16);
      ctx.fillRect(STAGE_W / 2 - 190, y - 22, 380, 44);
      text(ctx, "▶", STAGE_W / 2 - 160, y, font(20), COLOR.accent);
    }
    text(
      ctx,
      item,
      STAGE_W / 2,
      y,
      font(on ? 28 : 24),
      on ? COLOR.text : COLOR.textDim,
    );
  });
}

const HOWTO_LINES: readonly string[] = [
  "A data-worm winds down the board. Cut every segment of it",
  "with your bolts before one of them reaches your band.",
  "",
  "Every node the worm is turned by gains charge, and a node",
  "you shoot at full charge DETONATES: the discharge arcs",
  "through the charged cluster around it, clearing those nodes",
  "and frying every worm segment caught in the arc.",
  "",
  "A worm that reaches a critical node dives straight down it.",
  "Every segment you cut leaves a fresh node behind, so the",
  "field thickens as the fight goes on.",
  "",
  "GLITCH eats the field.  DROPPER reseeds it as it falls.",
  "CORRUPTOR slams what it crosses straight to critical.",
];

/**
 * The controls the how-to names. Each key is drawn as a run of its own, so the
 * words `SPACE`, `ARROWS` and `WASD` stand alone on the screen the way
 * `specs/ui.md` asks for them.
 */
const HOWTO_CONTROLS: readonly { label: string; keys: readonly string[] }[] = [
  { label: "MOVE", keys: ["ARROWS", "WASD"] },
  { label: "FIRE", keys: ["SPACE"] },
  { label: "PAUSE", keys: ["P"] },
  { label: "MUTE", keys: ["M"] },
];

/** Everything above the board: the HUD, the level banner, and each screen. */
export function renderUi(state: WirewormState, ctx: Ctx): void {
  if (boardVisible(state.screen)) renderHud(state, ctx);

  switch (state.screen) {
    case "title":
      renderTitle(state, ctx);
      return;
    case "howto":
      renderHowto(ctx);
      return;
    case "playing":
      if (state.phase === "banner") renderBanner(state, ctx);
      return;
    case "paused":
      scrim(ctx);
      text(ctx, "PAUSED", STAGE_W / 2, 240, font(52), COLOR.text);
      renderMenu(ctx, PAUSE_ITEMS, state.menuIndex, 340);
      return;
    case "victory":
      scrim(ctx);
      text(ctx, "SYSTEM CLEAN", STAGE_W / 2, 190, font(58), COLOR.accent);
      text(
        ctx,
        `ALL ${TOTAL_LEVELS} LEVELS CLEARED`,
        STAGE_W / 2,
        260,
        font(26),
        COLOR.text,
      );
      text(
        ctx,
        `SCORE ${state.score}`,
        STAGE_W / 2,
        312,
        digits(34),
        COLOR.gold,
      );
      text(
        ctx,
        `LIVES REMAINING ${state.lives}`,
        STAGE_W / 2,
        358,
        font(22),
        COLOR.textDim,
      );
      renderMenu(ctx, ENDING_ITEMS, state.menuIndex, 440);
      return;
    case "gameover":
      scrim(ctx);
      text(ctx, "SYSTEM LOST", STAGE_W / 2, 200, font(58), COLOR.warn);
      text(
        ctx,
        `SCORE ${state.score}`,
        STAGE_W / 2,
        282,
        digits(34),
        COLOR.gold,
      );
      text(
        ctx,
        `REACHED ${HUD_LEVEL_LABEL} ${state.reachedLevel} OF ${TOTAL_LEVELS}`,
        STAGE_W / 2,
        330,
        font(24),
        COLOR.text,
      );
      renderMenu(ctx, ENDING_ITEMS, state.menuIndex, 420);
      return;
  }
}

function renderTitle(state: WirewormState, ctx: Ctx): void {
  text(ctx, TITLE_TEXT, STAGE_W / 2, 210, font(96), COLOR.accent);
  text(ctx, TAGLINE_TEXT, STAGE_W / 2, 286, font(26), COLOR.textDim);
  renderMenu(ctx, TITLE_ITEMS, state.menuIndex, 420);
  text(
    ctx,
    "ARROWS or WASD to move    SPACE to fire",
    STAGE_W / 2,
    640,
    font(18),
    COLOR.textDim,
  );
}

function renderHowto(ctx: Ctx): void {
  text(ctx, "HOW TO PLAY", STAGE_W / 2, 96, font(46), COLOR.accent);
  HOWTO_LINES.forEach((line, index) => {
    text(
      ctx,
      line,
      STAGE_W / 2,
      158 + index * 26,
      font(20, "normal"),
      COLOR.text,
    );
  });
  HOWTO_CONTROLS.forEach((row, index) => {
    const y = 546 + index * 28;
    text(ctx, row.label, STAGE_W / 2 - 40, y, font(19), COLOR.textDim, "right");
    let x = STAGE_W / 2 - 10;
    row.keys.forEach((key, at) => {
      if (at > 0) {
        text(ctx, "or", x, y, font(16, "normal"), COLOR.textDim, "left");
        ctx.font = font(16, "normal");
        x += ctx.measureText("or").width + 12;
      }
      text(ctx, key, x, y, digits(20), COLOR.accent, "left");
      ctx.font = digits(20);
      x += ctx.measureText(key).width + 12;
    });
  });
  text(ctx, "ESC to go back", STAGE_W / 2, 688, font(16), COLOR.textDim);
}

/** The level's banner, over the board, while the banner phase runs. */
function renderBanner(state: WirewormState, ctx: Ctx): void {
  ctx.fillStyle = withAlpha(COLOR.void, 0.55);
  ctx.fillRect(0, 300, STAGE_W, 128);
  text(
    ctx,
    `${HUD_LEVEL_LABEL} ${state.level}`,
    STAGE_W / 2,
    364,
    font(64),
    COLOR.accent,
  );
}
