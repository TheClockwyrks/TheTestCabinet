// Refract — all canvas drawing, in logical 1280x720 coordinates.
//
// `render` is a pure read of the state it is handed: nothing here advances or
// stores anything, and the context arrives cleared and already carrying the
// logical transform, so no code below reads the canvas element's size.
//
// The look is this build's own (src/theme.ts). What it must deliver is
// legibility (specs/overview.md, specs/board.md): channels told apart by hue
// AND by silhouette, emitters outlined against lenses' fill, crystals a form
// of their own showing charges and spends, beams visibly connecting the cell
// centers they link, and every piece of text readable at the stage size.

import { cellX, cellY } from "./board";
import {
  BACK_LABEL,
  BINDINGS,
  CAMPAIGN_LENGTH,
  CLEAR_LABEL,
  HUD_SOLVED_LABEL,
  HUD_TIER_LABEL,
  NODE_R,
  SET_LABELS,
  SOLVED_TITLE_TEXT,
  STAGE_CX,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TITLE_ITEMS,
  TITLE_TEXT,
} from "./constants";
import {
  completePanel,
  CONTROL_H,
  CONTROL_W,
  HOWTO_BACK,
  PANEL_CX,
  PANEL_MENU_GAP,
  PANEL_MENU_SIZE,
  PANEL_W,
  PLAYING_BACK,
  PLAYING_CLEAR,
  SELECT_BACK,
  SELECT_COLS,
  SELECT_FIRST_X,
  solvedPanel,
  TILE_H,
  TILE_PITCH_X,
  TILE_W,
  tileCenter,
  TITLE_MENU_FIRST_Y,
  TITLE_MENU_GAP,
  TITLE_MENU_SIZE,
} from "./layout";
import { beamComplete, spentAt } from "./rules";
import { CHANNEL_COLOR, COLOR, font, withAlpha } from "./theme";
import { channelsOn } from "./board";
import type {
  BeamState,
  BoardState,
  Channel,
  NodeState,
  RefractState,
} from "./game";

type Ctx = CanvasRenderingContext2D;

/** The human name of a key binding's first code: `KeyR` reads as `R`. */
function keyLabel(code: string): string {
  return code.startsWith("Key") ? code.slice(3) : code;
}

const CLEAR_KEY = keyLabel(BINDINGS.clear[0]);

/**
 * One of the on-screen controls the pointer works a screen through, drawn on
 * the rectangle `src/layout.ts` hit-tests, with the key that does the same
 * thing named beneath it.
 */
function drawControl(
  ctx: Ctx,
  center: { x: number; y: number },
  label: string,
  key: string,
): void {
  pathRoundRect(
    ctx,
    center.x - CONTROL_W / 2,
    center.y - CONTROL_H / 2,
    CONTROL_W,
    CONTROL_H,
    12,
  );
  ctx.fillStyle = withAlpha(COLOR.bright, 0.06);
  ctx.fill();
  ctx.strokeStyle = COLOR.dim;
  ctx.lineWidth = 2;
  ctx.stroke();
  text(ctx, label, center.x, center.y - 4, 20, COLOR.text, "center", 700);
  text(ctx, key, center.x, center.y + 20, 14, COLOR.dim);
}

// ---- Shared furniture ----------------------------------------------------

function drawBench(ctx: Ctx): void {
  const glow = ctx.createRadialGradient(
    STAGE_CX,
    STAGE_H * 0.55,
    80,
    STAGE_CX,
    STAGE_H * 0.55,
    720,
  );
  glow.addColorStop(0, COLOR.benchGlow);
  glow.addColorStop(1, COLOR.bg);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function pathRoundRect(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function text(
  ctx: Ctx,
  content: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = "center",
  weight = 600,
): void {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(content, x, y);
}

/**
 * A vertical menu with the highlighted item drawn distinctly: brighter, on an
 * underline in the accent hue, with side markers, so which item `confirm`
 * would accept is never a guess.
 */
function drawMenu(
  ctx: Ctx,
  items: readonly string[],
  highlighted: number,
  cx: number,
  firstY: number,
  gap: number,
  size: number,
): void {
  items.forEach((item, index) => {
    const y = firstY + index * gap;
    const active = index === highlighted;
    if (active) {
      ctx.font = font(size, 700);
      const width = ctx.measureText(item).width;
      ctx.fillStyle = withAlpha(COLOR.bright, 0.08);
      pathRoundRect(
        ctx,
        cx - width / 2 - 26,
        y - size * 0.75,
        width + 52,
        size * 1.5,
        8,
      );
      ctx.fill();
      ctx.fillStyle = CHANNEL_COLOR.square;
      ctx.fillRect(cx - width / 2, y + size * 0.62, width, 3);
      const marker = (direction: 1 | -1): void => {
        const mx = cx + direction * (width / 2 + 40);
        ctx.beginPath();
        ctx.moveTo(mx, y);
        ctx.lineTo(mx - direction * 12, y - 7);
        ctx.lineTo(mx - direction * 12, y + 7);
        ctx.closePath();
        ctx.fillStyle = COLOR.bright;
        ctx.fill();
      };
      marker(1);
      marker(-1);
    }
    text(
      ctx,
      item,
      cx,
      y,
      size,
      active ? COLOR.bright : COLOR.dim,
      "center",
      active ? 700 : 600,
    );
  });
}

// ---- Nodes and beams -----------------------------------------------------

/** The silhouette that carries a channel's identity by form. */
function silhouettePath(
  ctx: Ctx,
  channel: Channel,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  switch (channel) {
    case "triangle":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.92, y + r * 0.72);
      ctx.lineTo(x - r * 0.92, y + r * 0.72);
      break;
    case "square":
      ctx.moveTo(x - r * 0.78, y - r * 0.78);
      ctx.lineTo(x + r * 0.78, y - r * 0.78);
      ctx.lineTo(x + r * 0.78, y + r * 0.78);
      ctx.lineTo(x - r * 0.78, y + r * 0.78);
      break;
    case "diamond":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      break;
  }
  ctx.closePath();
}

function hexagonPath(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 6 + (i * Math.PI) / 3;
    const px = x + r * Math.cos(angle);
    const py = y + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * A crystal: a hexagon — a form none of the three channels wears — with one
 * pip per charge, spent pips darkened, so charges and spends both read at a
 * glance without counting segments.
 */
function drawCrystal(
  ctx: Ctx,
  x: number,
  y: number,
  charges: number,
  spent: number,
): void {
  hexagonPath(ctx, x, y, NODE_R * 0.8);
  ctx.fillStyle = withAlpha(COLOR.crystal, 0.14);
  ctx.fill();
  ctx.strokeStyle = spent >= charges ? COLOR.crystalSpent : COLOR.crystalEdge;
  ctx.lineWidth = 3;
  ctx.stroke();

  const pitch = 12;
  const firstX = x - ((charges - 1) * pitch) / 2;
  for (let i = 0; i < charges; i++) {
    const isSpent = i < spent;
    ctx.beginPath();
    ctx.arc(firstX + i * pitch, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = isSpent ? COLOR.crystalSpent : COLOR.crystal;
    ctx.fill();
  }
}

function drawNode(
  ctx: Ctx,
  node: NodeState,
  x: number,
  y: number,
  beams: readonly BeamState[],
): void {
  if (node.kind === "crystal") {
    drawCrystal(ctx, x, y, node.charges ?? 0, spentAt(beams, node));
    return;
  }
  const channel = node.channel as Channel;
  const hue = CHANNEL_COLOR[channel];
  const r = NODE_R * 0.72;
  if (node.kind === "emitter") {
    // The outlined silhouette, with a soft halo so an endpoint reads as a
    // source of light.
    silhouettePath(ctx, channel, x, y, r + 4);
    ctx.strokeStyle = withAlpha(hue, 0.25);
    ctx.lineWidth = 9;
    ctx.stroke();
    silhouettePath(ctx, channel, x, y, r);
    ctx.strokeStyle = hue;
    ctx.lineWidth = 4;
    ctx.stroke();
  } else {
    // The filled silhouette.
    silhouettePath(ctx, channel, x, y, r);
    ctx.fillStyle = hue;
    ctx.fill();
  }
}

function drawBeam(
  ctx: Ctx,
  beam: BeamState,
  board: BoardState,
  livePulse: number | null,
): void {
  if (beam.cells.length === 0) return;
  const points = beam.cells.map((cell) => [
    cellX(cell.col, board.cols),
    cellY(cell.row, board.rows),
  ]);
  const hue = CHANNEL_COLOR[beam.channel];
  if (points.length >= 2) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const [width, alpha] of [
      [14, 0.18],
      [5, 1],
    ]) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
      ctx.strokeStyle = withAlpha(hue, alpha);
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }
  if (livePulse !== null) {
    const [x, y] = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(x, y, NODE_R * (0.6 + 0.12 * livePulse), 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(hue, 0.55);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function drawBoard(state: RefractState, ctx: Ctx): void {
  const { board, beams } = state;

  // Every cell of the current board, empty ones as quiet markers.
  ctx.fillStyle = COLOR.faint;
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      ctx.beginPath();
      ctx.arc(
        cellX(col, board.cols),
        cellY(row, board.rows),
        2.5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }

  // Beams under the nodes, so a node's form stays crisp over its own light.
  const pulse = 0.5 + 0.5 * Math.sin(state.simTime * Math.PI * 3.2);
  for (const beam of beams) {
    const live = state.tracing?.channel === beam.channel ? pulse : null;
    drawBeam(ctx, beam, board, live);
  }

  // A faint intent line from the live end toward the pointer while tracing.
  if (state.tracing !== null) {
    const beam = beams.find(
      (entry) => entry.channel === state.tracing?.channel,
    );
    const live = beam?.cells[beam.cells.length - 1];
    if (live) {
      ctx.beginPath();
      ctx.moveTo(cellX(live.col, board.cols), cellY(live.row, board.rows));
      ctx.lineTo(state.pointer.x, state.pointer.y);
      ctx.strokeStyle = withAlpha(CHANNEL_COLOR[state.tracing.channel], 0.25);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 8]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  for (const node of board.nodes) {
    drawNode(
      ctx,
      node,
      cellX(node.col, board.cols),
      cellY(node.row, board.rows),
      beams,
    );
  }
}

// ---- The playing screen --------------------------------------------------

function drawPlayingHud(state: RefractState, ctx: Ctx): void {
  if (state.mode === "campaign") {
    text(ctx, `BOARD ${state.boardIndex + 1}`, STAGE_CX, 72, 34, COLOR.text);
  } else {
    text(
      ctx,
      `${HUD_SOLVED_LABEL}  ${state.solvedCount}`,
      120,
      72,
      26,
      COLOR.text,
      "left",
    );
    text(
      ctx,
      `${HUD_TIER_LABEL}  ${state.tier}`,
      STAGE_W - 120,
      72,
      26,
      COLOR.text,
      "right",
    );
  }

  // The footer: the two on-screen controls, each carrying its pointer target
  // and naming the key that does the same thing, and per-channel progress
  // carried on each channel's own hue and silhouette.
  drawControl(ctx, PLAYING_CLEAR, CLEAR_LABEL, CLEAR_KEY);
  drawControl(ctx, PLAYING_BACK, BACK_LABEL, "ESC");

  const channels = channelsOn(state.board);
  const pitch = 64;
  const firstX = STAGE_CX - ((channels.length - 1) * pitch) / 2;
  channels.forEach((channel, index) => {
    const beam = state.beams.find((entry) => entry.channel === channel);
    const complete = beam ? beamComplete(state.board, beam) : false;
    const x = firstX + index * pitch;
    const hue = CHANNEL_COLOR[channel];
    silhouettePath(ctx, channel, x - 12, 694, 10);
    if (complete) {
      ctx.fillStyle = hue;
      ctx.fill();
    } else {
      ctx.strokeStyle = withAlpha(hue, 0.6);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    text(
      ctx,
      complete ? "✓" : "·",
      x + 8,
      694,
      18,
      complete ? hue : COLOR.dim,
      "left",
    );
  });
}

// ---- Menus and overlays --------------------------------------------------

function drawTitle(state: RefractState, ctx: Ctx): void {
  // A beam meets a prism and leaves as the three channel hues.
  const prismX = STAGE_CX;
  const prismY = 150;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(prismX - 300, prismY + 26);
  ctx.lineTo(prismX - 16, prismY + 8);
  ctx.strokeStyle = withAlpha(COLOR.bright, 0.5);
  ctx.lineWidth = 3;
  ctx.stroke();
  (Object.entries(CHANNEL_COLOR) as [Channel, string][]).forEach(
    ([, hue], index) => {
      ctx.beginPath();
      ctx.moveTo(prismX + 16, prismY + 8);
      ctx.lineTo(prismX + 300, prismY - 26 + index * 34);
      ctx.strokeStyle = withAlpha(hue, 0.7);
      ctx.lineWidth = 3;
      ctx.stroke();
    },
  );
  ctx.beginPath();
  ctx.moveTo(prismX, prismY - 26);
  ctx.lineTo(prismX + 28, prismY + 22);
  ctx.lineTo(prismX - 28, prismY + 22);
  ctx.closePath();
  ctx.strokeStyle = COLOR.dim;
  ctx.lineWidth = 3;
  ctx.stroke();

  text(ctx, TITLE_TEXT, STAGE_CX, 268, 96, COLOR.text, "center", 700);
  text(ctx, TAGLINE_TEXT, STAGE_CX, 336, 24, COLOR.dim);

  drawMenu(
    ctx,
    TITLE_ITEMS,
    state.menuIndex,
    STAGE_CX,
    TITLE_MENU_FIRST_Y,
    TITLE_MENU_GAP,
    TITLE_MENU_SIZE,
  );

  text(
    ctx,
    "CLICK, TAP, OR ARROWS / WASD · ENTER — SELECT · M — SOUND",
    STAGE_CX,
    668,
    16,
    COLOR.dim,
  );
}

const HOWTO_LINES: readonly string[] = [
  "Each board is a lattice of optical nodes, and every channel — triangle,",
  "square, diamond — has its own two emitters. Press on a node and drag along",
  "the nodes its beam should thread; release, and the beam stays as drawn.",
  "",
  "• Outlined shapes are emitters. A channel's beam runs from one of its",
  "   emitters to the other.",
  "• Filled shapes are lenses. The beam must pass through every lens of its",
  "   own channel — in once, out once.",
  "• A segment joins a node to any of the eight nodes around it, diagonals",
  "   included, and never reaches across an empty cell.",
  "• A beam never touches another channel's emitters or lenses.",
  "• Hexagons are crystals. Any beam may cross one, and every charge must be",
  "   spent — no more, no fewer. The pips show spent and remaining charges.",
  "• Each segment is drawn once, and no two beams share one.",
  "• Two segments never cross: only one diagonal of a square of four cells",
  "   can be drawn.",
  "• A move the rules refuse simply does not take — the beam stays as it was.",
  "   Back the pointer along the beam to unwind it.",
  `• Press ${CLEAR_KEY} to clear every beam and start the board over.`,
];

function drawHowto(ctx: Ctx): void {
  text(ctx, "HOW TO PLAY", STAGE_CX, 78, 40, COLOR.text, "center", 700);
  HOWTO_LINES.forEach((line, index) => {
    text(ctx, line, 248, 130 + index * 25, 19, COLOR.text, "left", 500);
  });
  drawControl(ctx, HOWTO_BACK, BACK_LABEL, "ESC");
}

function drawLock(ctx: Ctx, x: number, y: number): void {
  ctx.strokeStyle = COLOR.dim;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - 2, 5, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = COLOR.dim;
  ctx.fillRect(x - 7, y - 2, 14, 10);
}

function drawCheck(ctx: Ctx, x: number, y: number): void {
  ctx.strokeStyle = COLOR.solvedEdge;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x - 2, y + 5);
  ctx.lineTo(x + 8, y - 6);
  ctx.stroke();
}

function drawSelect(state: RefractState, ctx: Ctx): void {
  text(ctx, "SELECT BOARD", STAGE_CX, 92, 40, COLOR.text, "center", 700);

  const firstX = SELECT_FIRST_X;
  for (let index = 0; index < CAMPAIGN_LENGTH; index++) {
    const col = index % SELECT_COLS;
    const row = Math.floor(index / SELECT_COLS);
    const { x: cx, y: cy } = tileCenter(index);
    const locked = index >= state.unlockedCount;
    const solved = state.solvedBoards.includes(index);

    if (col === 0) {
      text(
        ctx,
        SET_LABELS[row],
        firstX - TILE_PITCH_X + 20,
        cy,
        20,
        COLOR.dim,
        "right",
      );
    }

    pathRoundRect(ctx, cx - TILE_W / 2, cy - TILE_H / 2, TILE_W, TILE_H, 10);
    if (locked) {
      ctx.fillStyle = COLOR.locked;
      ctx.fill();
      ctx.strokeStyle = COLOR.lockedEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (solved) {
      ctx.fillStyle = COLOR.solvedTile;
      ctx.fill();
      ctx.strokeStyle = COLOR.solvedEdge;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.fillStyle = withAlpha(COLOR.bright, 0.04);
      ctx.fill();
      ctx.strokeStyle = COLOR.dim;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    text(
      ctx,
      String(index + 1),
      cx,
      cy - 8,
      30,
      locked ? COLOR.dim : COLOR.text,
      "center",
      700,
    );
    if (locked) drawLock(ctx, cx, cy + 20);
    else if (solved) drawCheck(ctx, cx, cy + 20);

    if (index === state.selectIndex) {
      pathRoundRect(
        ctx,
        cx - TILE_W / 2 - 6,
        cy - TILE_H / 2 - 6,
        TILE_W + 12,
        TILE_H + 12,
        13,
      );
      ctx.strokeStyle = COLOR.bright;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  drawControl(ctx, SELECT_BACK, BACK_LABEL, "ESC");
}

/** The light wash and side panel every over-the-board screen is drawn on. */
function drawOverlayPanel(ctx: Ctx, height: number): number {
  ctx.fillStyle = COLOR.scrim;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  const top = 360 - height / 2;
  pathRoundRect(ctx, PANEL_CX - PANEL_W / 2, top, PANEL_W, height, 14);
  ctx.fillStyle = COLOR.panelSolid;
  ctx.fill();
  ctx.strokeStyle = COLOR.panelBorder;
  ctx.lineWidth = 2;
  ctx.stroke();
  return top;
}

function drawSolvedOverlay(state: RefractState, ctx: Ctx): void {
  const panel = solvedPanel(state);
  drawOverlayPanel(ctx, panel.height);
  const top = panel.top;
  if (state.mode === "campaign") {
    text(
      ctx,
      `BOARD ${state.boardIndex + 1} SOLVED`,
      PANEL_CX,
      top + 48,
      26,
      COLOR.text,
      "center",
      700,
    );
  } else {
    text(
      ctx,
      SOLVED_TITLE_TEXT,
      PANEL_CX,
      top + 48,
      26,
      COLOR.text,
      "center",
      700,
    );
    text(
      ctx,
      `${HUD_SOLVED_LABEL}  ${state.solvedCount}`,
      PANEL_CX,
      top + 84,
      19,
      COLOR.dim,
    );
  }
  drawMenu(
    ctx,
    panel.items,
    state.menuIndex,
    PANEL_CX,
    panel.firstY,
    PANEL_MENU_GAP,
    PANEL_MENU_SIZE,
  );
}

function drawCompleteOverlay(state: RefractState, ctx: Ctx): void {
  const panel = completePanel();
  drawOverlayPanel(ctx, panel.height);
  const top = panel.top;
  text(ctx, "CAMPAIGN", PANEL_CX, top + 40, 26, COLOR.text, "center", 700);
  text(ctx, "COMPLETE", PANEL_CX, top + 70, 26, COLOR.text, "center", 700);
  text(
    ctx,
    `ALL ${CAMPAIGN_LENGTH} BOARDS SOLVED`,
    PANEL_CX,
    top + 102,
    16,
    COLOR.dim,
  );
  drawMenu(
    ctx,
    panel.items,
    state.menuIndex,
    PANEL_CX,
    panel.firstY,
    PANEL_MENU_GAP,
    PANEL_MENU_SIZE,
  );
}

// ---- Entry ---------------------------------------------------------------

export function renderGame(state: RefractState, ctx: Ctx): void {
  drawBench(ctx);
  switch (state.screen) {
    case "title":
      drawTitle(state, ctx);
      break;
    case "howto":
      drawHowto(ctx);
      break;
    case "select":
      drawSelect(state, ctx);
      break;
    case "playing":
      drawBoard(state, ctx);
      drawPlayingHud(state, ctx);
      break;
    case "solved":
      // The finished board stays visible behind the screen, every beam as
      // the player drew it (specs/modes/campaign.md, specs/modes/cascade.md).
      drawBoard(state, ctx);
      drawSolvedOverlay(state, ctx);
      break;
    case "complete":
      drawBoard(state, ctx);
      drawCompleteOverlay(state, ctx);
      break;
  }
}
