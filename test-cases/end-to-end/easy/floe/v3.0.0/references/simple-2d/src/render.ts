// Floe — all canvas drawing, in logical `STAGE_W x STAGE_H` coordinates.
//
// `api.ctx` arrives cleared and already carrying the engine's logical transform, so
// nothing here reads the canvas element's size and nothing here scales: every
// coordinate below is a stage coordinate, and the fit is the engine's.
//
// THE STRAIT IS DRAWN IN BANDS, one flat fill each, so the five bands
// `specs/overview.md`'s legibility table asks a player to tell apart are each one
// tint across their whole width. The decoration on top of them — the lane hairlines,
// the crests on the water, the ridge ticks on the median — is deliberately sparse and
// low-contrast, so it reads as texture rather than as a second tint.
//
// THE SEEDED ART IS DRAWN UNCHANGED (`specs/assets.md`). A `32 x 32` frame goes over
// one tile centred on its subject's centre; a lane item's frame goes `32` units wide
// per tile it spans with its left edge on the item's own `x` and its top on its row's
// top edge; the three-tile raft is the left `96 x 32` of `assets/raft/0.png` and the
// four-tile raft the whole of `assets/raft/1.png`; and a vehicle in a leftward lane
// is drawn under a negative horizontal scale, so every vehicle faces the way its lane
// runs. The bear is never mirrored — it carries a frame set per facing.
//
// A FRAME THAT DID NOT LOAD IS DRAWN AS A SHAPE. The game still plays, still reports
// its state and still reads legibly in a host that cannot decode an image, which is
// what the build's own tests run in.

import {
  BAYS,
  BAY_COUNT,
  CAR_W,
  DOGSLED_W,
  ENDING_ITEMS,
  HUD_H,
  HUD_LEVEL_LABEL,
  ICE_BOTTOM,
  ICE_TOP,
  PAN_W,
  PAUSE_ITEMS,
  PLOW_W,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  SPRITE_TILE,
  STAGE_H,
  STAGE_W,
  TAGLINE_TEXT,
  TILE,
  TITLE_ITEMS,
  TITLE_TEXT,
  TOTAL_LEVELS,
  WATER_BOTTOM,
  WATER_TOP,
  tileLeft,
  tileTop,
} from "./constants";
import {
  BEAR_LUNGE_FRAME,
  BEAR_RUN_FRAME,
  BEAR_SWIM_FRAME,
  CROSSER_FRAME,
  type Frames,
} from "./assets";
import { swimming } from "./hunter";
import { ANIM_FPS, COLOR, FONT, font } from "./theme";
import { bayCenterX } from "./strait";
import { toSim, type MutFloe, type MutVehicle, type Sim } from "./sim";
import type { Facing, FloeState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** The how-to screen's lines: the six things `specs/ui.md` asks it to name. */
const HOWTO_LINES: readonly string[] = [
  "FILL ALL FIVE BAYS IN THE FAR SHORE TO CLEAR A LEVEL.",
  "ARROW KEYS OR W A S D HOP THE CRITTER ONE TILE AT A TIME.",
  "A POLAR BEAR HUNTS YOU ACROSS THE WHOLE STRAIT, ON ICE AND IN WATER.",
  "PLOWS, DOGSLEDS AND CARS SLIDE ALONG THE EIGHT ICE LANES.",
  "FLOES DRIFT ALONG THE EIGHT WATER LANES: RIDE THEM ACROSS.",
  "EVERY CROSSING IS UNDER A TIMER. LET IT RUN OUT AND YOU LOSE A LIFE.",
  "P OR ESC PAUSES.  M MUTES.  BACKTICK SHOWS THE DEBUG OVERLAY.",
];

/** Which of a two-frame pair is showing, from the animation clock. */
function phaseOf(animTime: number): number {
  return Math.floor(animTime * ANIM_FPS) % 2;
}

/** The frame at `index`, or `null` where it did not load. */
function frameAt(frames: Frames, index: number): ImageBitmap | null {
  return frames[index] ?? null;
}

/** A `32 x 32` frame over one tile, centred on `(cx, cy)`. */
function drawTileSprite(
  ctx: CanvasRenderingContext2D,
  frame: ImageBitmap | null,
  cx: number,
  cy: number,
  fallback: string,
): void {
  const left = cx - SPRITE_TILE / 2;
  const top = cy - SPRITE_TILE / 2;
  if (frame === null) {
    ctx.fillStyle = fallback;
    ctx.fillRect(left + 4, top + 4, SPRITE_TILE - 8, SPRITE_TILE - 8);
    return;
  }
  ctx.drawImage(frame, left, top, SPRITE_TILE, SPRITE_TILE);
}

/**
 * A lane item's frame, `32` units wide per tile it spans, its left edge on the
 * item's own `x` and its top on its row's top edge.
 *
 * A leftward lane's vehicle is drawn under a negative horizontal scale, which is
 * how the art that faces right faces the way the lane runs.
 */
function drawLaneSprite(
  ctx: CanvasRenderingContext2D,
  frame: ImageBitmap | null,
  x: number,
  row: number,
  width: number,
  options: {
    mirrored: boolean;
    source: [number, number] | null;
    fallback: string;
  },
): void {
  const top = tileTop(row);
  if (frame === null) {
    ctx.fillStyle = options.fallback;
    ctx.fillRect(x + 2, top + 4, width - 4, TILE - 8);
    return;
  }
  ctx.save();
  if (options.mirrored) {
    ctx.translate(x + width, top);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(x, top);
  }
  if (options.source === null) {
    ctx.drawImage(frame, 0, 0, width, TILE);
  } else {
    ctx.drawImage(
      frame,
      0,
      0,
      options.source[0],
      options.source[1],
      0,
      0,
      width,
      TILE,
    );
  }
  ctx.restore();
}

/** One flat band across the strait, `rows` rows deep from `row`. */
function band(
  ctx: CanvasRenderingContext2D,
  row: number,
  rows: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, tileTop(row), STAGE_W, rows * TILE);
}

/** A hairline across the strait at a row's top edge. */
function edge(ctx: CanvasRenderingContext2D, row: number): void {
  ctx.fillStyle = COLOR.bandEdge;
  ctx.fillRect(0, tileTop(row), STAGE_W, 1);
}

/** The five bands, the bays, and the texture over them (`specs/strait.md`). */
function drawStrait(ctx: CanvasRenderingContext2D, sim: Sim): void {
  band(ctx, ROW_CAP, 2, COLOR.farShore);
  band(ctx, WATER_TOP, WATER_BOTTOM - WATER_TOP + 1, COLOR.water);
  band(ctx, ROW_MEDIAN, 1, COLOR.median);
  band(ctx, ICE_TOP, ICE_BOTTOM - ICE_TOP + 1, COLOR.iceBand);
  band(ctx, ROW_NEAR, 1, COLOR.nearShore);

  // Crests on the water: two short dashes a row, offset row by row, so the water
  // reads as moving without shifting the band's own tint.
  ctx.fillStyle = COLOR.waterCrest;
  for (let row = WATER_TOP; row <= WATER_BOTTOM; row += 1) {
    const y = tileTop(row) + TILE / 2;
    for (let index = 0; index < 3; index += 1) {
      const x = 90 + index * 420 + (row % 4) * 70;
      ctx.fillRect(x, y, 150, 2);
    }
  }

  // A hairline along each ice lane, so the eight lanes read as eight.
  ctx.fillStyle = COLOR.laneRule;
  for (let row = ICE_TOP; row <= ICE_BOTTOM; row += 1) {
    ctx.fillRect(0, tileTop(row), STAGE_W, 1);
  }

  // Ridge ticks along the median, so the safe shelf reads as ridged old ice.
  ctx.fillStyle = COLOR.bandEdge;
  for (let x = 16; x < STAGE_W; x += 96) {
    ctx.fillRect(x, tileTop(ROW_MEDIAN) + 8, 3, TILE - 16);
  }

  edge(ctx, WATER_TOP);
  edge(ctx, ROW_MEDIAN);
  edge(ctx, ICE_TOP);
  edge(ctx, ROW_NEAR);

  drawBays(ctx, sim);
}

/** The five bays, open or filled (`specs/bays.md`). */
function drawBays(ctx: CanvasRenderingContext2D, sim: Sim): void {
  const top = tileTop(ROW_BAYS);
  for (let index = 0; index < BAY_COUNT; index += 1) {
    const pair = BAYS[index];
    const left = tileLeft(pair[0]);
    const width = 2 * TILE;
    const filled = sim.bays[index] === true;

    ctx.fillStyle = filled ? COLOR.bayFilled : COLOR.bayOpen;
    ctx.fillRect(left, top, width, TILE);

    // The lip, so an open bay reads as cut into the shore rather than painted on.
    ctx.fillStyle = COLOR.bayLip;
    ctx.fillRect(left, top, 2, TILE);
    ctx.fillRect(left + width - 2, top, 2, TILE);
    ctx.fillRect(left, top + TILE - 2, width, 2);

    if (filled) {
      // The critter that filled it rests there for the level (`specs/bays.md`).
      drawTileSprite(
        ctx,
        frameAt(sim.sprites.crosser, CROSSER_FRAME.up),
        left + width / 2,
        top + TILE / 2,
        COLOR.bayLip,
      );
    }
  }
}

/** The bonus catch, drawn in code in the bay it is visiting (`specs/bays.md`). */
function drawFish(ctx: CanvasRenderingContext2D, sim: Sim): void {
  if (sim.fishBay === null) return;
  const cx = bayCenterX(sim.fishBay);
  const cy = tileTop(ROW_BAYS) + TILE / 2;

  ctx.fillStyle = COLOR.fish;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLOR.fishDark;
  ctx.beginPath();
  ctx.moveTo(cx + 9, cy);
  ctx.lineTo(cx + 16, cy - 5);
  ctx.lineTo(cx + 16, cy + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx - 6, cy - 2, 2, 2);
}

/** The drawn width of one lane item, `32` units per tile it spans. */
function itemWidth(len: number): number {
  return len * TILE;
}

/** Every floe on the water band (`specs/water.md`, `specs/assets.md`). */
function drawFloes(ctx: CanvasRenderingContext2D, sim: Sim): void {
  for (const item of sim.floes) {
    drawFloeItem(ctx, sim, item);
  }
}

function drawFloeItem(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  item: MutFloe,
): void {
  const width = itemWidth(item.len);
  if (item.kind === "pan") {
    drawLaneSprite(ctx, frameAt(sim.sprites.pan, 0), item.x, item.row, PAN_W, {
      mirrored: false,
      source: null,
      fallback: COLOR.bayLip,
    });
    return;
  }
  // The three-tile raft is the LEFT 96 x 32 of frame 0; the four-tile raft is the
  // whole of frame 1 (`specs/assets.md`).
  const three = item.kind === "raft3";
  drawLaneSprite(
    ctx,
    frameAt(sim.sprites.raft, three ? 0 : 1),
    item.x,
    item.row,
    width,
    {
      mirrored: false,
      // The left 96 x 32 of frame 0 for the three-tile raft, the whole
      // 128 x 32 of frame 1 for the four-tile one (`specs/assets.md`).
      source: [item.len * SPRITE_TILE, SPRITE_TILE],
      fallback: COLOR.bayLip,
    },
  );
}

/** Every vehicle on the ice band (`specs/ice.md`, `specs/assets.md`). */
function drawVehicles(ctx: CanvasRenderingContext2D, sim: Sim): void {
  for (const item of sim.vehicles) {
    drawVehicleItem(ctx, sim, item);
  }
}

function drawVehicleItem(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  item: MutVehicle,
): void {
  const lane = sim.iceLanes.find((entry) => entry.row === item.row);
  const mirrored = lane !== undefined && lane.dir === -1;
  const art =
    item.kind === "plow"
      ? { frames: sim.sprites.plow, width: PLOW_W }
      : item.kind === "dogsled"
        ? { frames: sim.sprites.dogsled, width: DOGSLED_W }
        : { frames: sim.sprites.car, width: CAR_W };
  drawLaneSprite(
    ctx,
    frameAt(art.frames, 0),
    item.x,
    item.row,
    itemWidth(item.len),
    { mirrored, source: null, fallback: COLOR.accent },
  );
}

/** The critter, from the pair for its facing (`specs/assets.md`). */
function drawCritter(ctx: CanvasRenderingContext2D, sim: Sim): void {
  if (!sim.critter.present) return;
  const index = CROSSER_FRAME[sim.critter.facing] + phaseOf(sim.animTime);
  drawTileSprite(
    ctx,
    frameAt(sim.sprites.crosser, index),
    sim.critter.x,
    sim.critter.y,
    COLOR.fish,
  );
}

/** The frame set a bear is drawn from, by what it is doing (`specs/assets.md`). */
function bearFrame(sim: Sim, facing: Facing, swim: boolean): number {
  const first = swim ? BEAR_SWIM_FRAME[facing] : BEAR_RUN_FRAME[facing];
  return first + phaseOf(sim.animTime);
}

/** Every bear, and the lunge the bear that caught the critter left behind. */
function drawBears(ctx: CanvasRenderingContext2D, sim: Sim): void {
  for (const bear of sim.bears) {
    const index = bearFrame(sim, bear.facing, swimming(sim, bear));
    drawTileSprite(
      ctx,
      frameAt(sim.sprites.bear, index),
      bear.x,
      bear.y,
      COLOR.splash,
    );
  }
  if (sim.lunge !== null) {
    drawTileSprite(
      ctx,
      frameAt(sim.sprites.bear, BEAR_LUNGE_FRAME + phaseOf(sim.animTime)),
      sim.lunge.x,
      sim.lunge.y,
      COLOR.splash,
    );
  }
}

/** One HUD readout: a small label with a figure under it. */
function readout(
  ctx: CanvasRenderingContext2D,
  x: number,
  label: string,
  value: string,
): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.hudLabel);
  ctx.fillText(label, x, 22);
  ctx.fillStyle = COLOR.text;
  ctx.font = font(FONT.hudValue);
  ctx.fillText(value, x, 50);
}

/** The HUD bar and its five readouts (`specs/ui.md`). */
function drawHud(ctx: CanvasRenderingContext2D, sim: Sim): void {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(0, 0, STAGE_W, HUD_H);
  ctx.fillStyle = COLOR.panelEdge;
  ctx.fillRect(0, HUD_H - 2, STAGE_W, 2);

  readout(ctx, 24, "SCORE", String(sim.score));
  readout(ctx, 300, "LIVES", String(sim.lives));
  readout(
    ctx,
    450,
    HUD_LEVEL_LABEL,
    `${String(sim.level)} / ${String(TOTAL_LEVELS)}`,
  );
  readout(ctx, 700, "TIME", Math.max(0, sim.timer).toFixed(1));

  drawBayReadout(ctx, sim);
}

/**
 * The fifth readout: one mark per bay, each at that bay's own position along the
 * strait, so the row of marks reads straight onto the shore below it.
 */
function drawBayReadout(ctx: CanvasRenderingContext2D, sim: Sim): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = COLOR.textDim;
  ctx.font = font(FONT.hudLabel);
  ctx.fillText("BAYS", 24, 72);

  for (let index = 0; index < BAY_COUNT; index += 1) {
    const cx = bayCenterX(index);
    if (sim.bays[index] === true) {
      ctx.fillStyle = COLOR.accent;
      ctx.fillRect(cx - 17, 58, 34, 16);
    } else {
      ctx.fillStyle = COLOR.panel;
      ctx.fillRect(cx - 17, 58, 34, 16);
      ctx.strokeStyle = COLOR.textDim;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - 16, 59, 32, 14);
    }
  }
}

/** A dark panel behind a screen's text, so every line is legible over it. */
function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = COLOR.panel;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, width - 2, height - 2);
}

/** One centred line. */
function centered(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size: number,
  color: string,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.font = font(size);
  ctx.fillText(text, STAGE_W / 2, y);
}

/** A screen's menu, the highlighted item drawn distinctly from the others. */
function drawMenu(
  ctx: CanvasRenderingContext2D,
  items: readonly string[],
  index: number,
  top: number,
): void {
  items.forEach((item, at) => {
    const chosen = at === index;
    // The item's own text is drawn as its own text, and the highlight is the
    // colour it is drawn in plus a marker beside it, so nothing is appended to
    // the copy `specs/ui.md` fixes.
    if (chosen) {
      ctx.fillStyle = COLOR.accent;
      ctx.fillRect(STAGE_W / 2 - 210, top + at * 44 - 16, 12, 16);
    }
    centered(
      ctx,
      item,
      top + at * 44,
      FONT.menu,
      chosen ? COLOR.accent : COLOR.menuIdle,
    );
  });
}

/** The scrim a screen's panel is laid over. */
function scrim(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
}

function drawTitle(ctx: CanvasRenderingContext2D, sim: Sim): void {
  scrim(ctx, COLOR.scrim);
  panel(ctx, 240, 130, 800, 440);
  centered(ctx, TITLE_TEXT, 290, FONT.title, COLOR.text);
  centered(ctx, TAGLINE_TEXT, 340, FONT.tagline, COLOR.textDim);
  drawMenu(ctx, TITLE_ITEMS, sim.menuIndex, 440);
  centered(
    ctx,
    "ARROWS OR W A S D TO MOVE   ENTER TO CHOOSE",
    540,
    FONT.body,
    COLOR.textDim,
  );
}

function drawHowto(ctx: CanvasRenderingContext2D): void {
  scrim(ctx, COLOR.scrim);
  panel(ctx, 100, 120, 1080, 470);
  centered(ctx, "HOW TO PLAY", 190, FONT.heading, COLOR.text);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = font(FONT.body);
  ctx.fillStyle = COLOR.textDim;
  HOWTO_LINES.forEach((line, index) => {
    ctx.fillText(line, 150, 250 + index * 42);
  });
  centered(ctx, "ENTER OR ESC TO GO BACK", 560, FONT.body, COLOR.text);
}

function drawPaused(ctx: CanvasRenderingContext2D, sim: Sim): void {
  scrim(ctx, COLOR.scrimPause);
  panel(ctx, 380, 200, 520, 320);
  centered(ctx, "PAUSED", 270, FONT.heading, COLOR.text);
  drawMenu(ctx, PAUSE_ITEMS, sim.menuIndex, 350);
  centered(ctx, "ESC RESUMES", 490, FONT.body, COLOR.textDim);
}

function drawEnding(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  won: boolean,
): void {
  scrim(ctx, COLOR.scrim);
  panel(ctx, 300, 150, 680, 420);
  centered(
    ctx,
    won ? "THE FAR SHORE" : "GAME OVER",
    220,
    FONT.heading,
    won ? COLOR.accent : COLOR.text,
  );
  centered(ctx, `SCORE ${String(sim.score)}`, 285, FONT.body, COLOR.text);
  if (won) {
    centered(
      ctx,
      `LEVELS CLEARED ${String(TOTAL_LEVELS)}`,
      325,
      FONT.body,
      COLOR.text,
    );
    centered(
      ctx,
      `LIVES REMAINING ${String(sim.lives)}`,
      365,
      FONT.body,
      COLOR.text,
    );
  } else {
    centered(
      ctx,
      `LEVEL REACHED ${String(sim.reachedLevel)}`,
      325,
      FONT.body,
      COLOR.text,
    );
  }
  drawMenu(ctx, ENDING_ITEMS, sim.menuIndex, 450);
}

/** Draw the whole frame the update left behind. */
export function renderGame(
  state: DeepReadonly<FloeState>,
  ctx: CanvasRenderingContext2D,
): void {
  const sim = toSim(state);

  ctx.fillStyle = COLOR.background;
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);

  drawStrait(ctx, sim);
  drawFloes(ctx, sim);
  drawVehicles(ctx, sim);
  drawFish(ctx, sim);
  drawCritter(ctx, sim);
  drawBears(ctx, sim);
  drawHud(ctx, sim);

  switch (sim.screen) {
    case "title":
      drawTitle(ctx, sim);
      return;
    case "howto":
      drawHowto(ctx);
      return;
    case "paused":
      drawPaused(ctx, sim);
      return;
    case "victory":
      drawEnding(ctx, sim, true);
      return;
    case "gameover":
      drawEnding(ctx, sim, false);
      return;
    default:
      return;
  }
}
