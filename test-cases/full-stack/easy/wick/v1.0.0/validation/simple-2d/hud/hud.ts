// hud/hud — what the points of this category share: where a bar's filled extent
// is read off two posed frames, where a slot's pixels are read, which produced
// icons a frame drew and in what order, and how several frames are kept as one
// picture. CASE-PROVIDED.
//
// No review item names this file. Each function is either a compound sequence
// of the surface's atomic operations or a reading of one frame, which the
// authoring guide has live beside the checks rather than inside any one of them.
//
// WHY THE HUD IS READ OFF PIXELS AND BLITS RATHER THAN OFF DRAW CALLS.
// specs/ui.md: "Wick fixes no palette, no font, and no styling for any screen,
// and each screen's layout is yours except where a table below places one
// element relative to another." A bar may be a `fillRect`, a `roundRect`, or a
// blitted image; a slot may be a frame, a disc, or nothing at all. What the
// specification does fix is that a bar is filled FROM ITS LEFT EDGE by its
// ratio, that a held item shows its PRODUCED ICON with its pips in a row
// outside the square the icon is drawn in, and that a slot's PICTURE changes
// with its cooldown state, so every reading here is of a width, of a column, of
// a produced file's blit, or of a rectangle's pixels, and never of a shape a
// build chose to draw with.
//
// HOW TWO FRAMES ARE MADE COMPARABLE. Every point below poses its scene through
// {@link isolate}, which resets first, so both frames of a pair are drawn on the
// same tick of the same empty night with the same lamplighter at the same place.
// The only pixels that may differ between them are the ones the point poses,
// which is what makes a pixel difference readable as the HUD element under test.

import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { fail } from "../assert";
import {
  ICON_IDS,
  ICON_SIZE,
  STAGE_H,
  STAGE_W,
  iconPath,
  type OfferId,
} from "../constants";
import {
  assetPath,
  blitBoxOnStage,
  blitsOfFile,
  blitsUnderDir,
  captureCanvas,
  drawnText,
  type Blit,
  type DrawCall,
  type Harness,
  type PixelRect,
} from "../harness";

/**
 * How far outside a held item's icon the rest of its slot is read.
 *
 * specs/ui.md fixes no slot geometry: a slot is "each held weapon as its icon
 * with one pip per level held", and its cooldown state is drawn "on each
 * weapon's slot". The icon is therefore the only part of a slot this project
 * can locate, and the slot is read as the icon's own box grown by one icon's
 * width on every side, which takes in a pip row, a frame, and a cooldown wash
 * drawn around the icon. A neighboring slot may fall inside that box, and
 * every point that reads one holds ONE item, so a neighbor is empty and stands
 * still in both frames of a comparison.
 */
export const SLOT_PAD = ICON_SIZE;

/**
 * How far a pip count read off two poses may fall from the count the levels
 * state: two fifths of one pip.
 *
 * specs/ui.md draws a held item "with one pip per level held" and puts "the
 * pips in a row", fixing no end of that row for the count to grow from, so an
 * area is what two levels compare. The pixels by which a slot at level `k`
 * differs from the same slot at level `1` are the marks the two poses do not
 * share, and for one mark repeated that area is `k - 1` marks whether the row
 * grows to the right, to the left, or out from its middle, as long as both
 * counts are odd and the middle mark is shared. Reading levels 1, 3, and 5
 * therefore gives exactly twice the area at 5 that it gives at 3 under every
 * one of those arrangements, and only a mark's own edge pixels sit between that
 * figure and a build's. Two fifths of a mark admits those and still refuses a
 * slot that ignores its level or spells the level out.
 */
export const PIP_RATIO_TOLERANCE = 0.4;

/** A rectangle of the stage, in logical stage units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The longest run of differing pixels one row of two frames holds. */
export interface DiffRun {
  /** The row it was found in, in device pixels from the top. */
  row: number;
  /** Where the run starts, in device pixels from the left. */
  x: number;
  /** How many pixels long it is. */
  width: number;
}

/** Whether the pixel at `index` differs between two equally sized rectangles. */
function pixelDiffers(a: PixelRect, b: PixelRect, index: number): boolean {
  const at = index * 4;
  return (
    a.data[at] !== b.data[at] ||
    a.data[at + 1] !== b.data[at + 1] ||
    a.data[at + 2] !== b.data[at + 2] ||
    a.data[at + 3] !== b.data[at + 3]
  );
}

/** The two rectangles are the same shape, or the point fails saying so. */
function sameShape(a: PixelRect, b: PixelRect): void {
  if (a.width !== b.width || a.height !== b.height) {
    fail(
      `two readings of the same rectangle (${a.width}x${a.height})`,
      `${b.width}x${b.height}`,
    );
  }
}

/** The longest run of horizontally adjacent differing pixels in one row. */
export function diffRunInRow(a: PixelRect, b: PixelRect, row: number): DiffRun {
  sameShape(a, b);
  let best: DiffRun = { row, x: 0, width: 0 };
  let start = -1;
  for (let x = 0; x <= a.width; x += 1) {
    const differing = x < a.width && pixelDiffers(a, b, row * a.width + x);
    if (differing) {
      if (start < 0) start = x;
      continue;
    }
    if (start >= 0) {
      if (x - start > best.width) best = { row, x: start, width: x - start };
      start = -1;
    }
  }
  return best;
}

/**
 * The longest run of horizontally adjacent differing pixels anywhere in two
 * frames: the reading a bar's extent is taken as.
 *
 * A bar drawn at two fills differs over a solid horizontal band as wide as the
 * fills are apart, and every other readout that moved with the same pose is a
 * run of text, whose longest horizontal stroke is a glyph wide. The longest run
 * in the frame is therefore the bar's, and `row` names a row of it, which is
 * where {@link diffRunInRow} reads the same bar at a second pair of fills.
 */
export function longestDiffRun(a: PixelRect, b: PixelRect): DiffRun {
  sameShape(a, b);
  let best: DiffRun = { row: 0, x: 0, width: 0 };
  for (let row = 0; row < a.height; row += 1) {
    const found = diffRunInRow(a, b, row);
    if (found.width > best.width) best = found;
  }
  return best;
}

/** One row of a rectangle, `width` pixels wide from `x`, as a rectangle. */
export function rowSlice(
  rect: PixelRect,
  row: number,
  x: number,
  width: number,
): PixelRect {
  const from = (row * rect.width + x) * 4;
  return {
    width,
    height: 1,
    data: rect.data.slice(from, from + width * 4),
  };
}

/** The whole stage, as pixels. */
export function stageRect(h: Harness): PixelRect {
  return h.pixelRect(0, 0, STAGE_W, STAGE_H);
}

/**
 * The one blit of the produced icon `id` a frame drew, or the point fails
 * naming the file that never reached the canvas.
 *
 * The LAST such blit, which is the one a player sees, so a build that draws an
 * icon twice, an outline under it or a highlight over it, is read at the
 * picture it left rather than failed for the pass count.
 */
export function iconBlit(blits: readonly Blit[], id: OfferId): Blit {
  const drawn = blitsOfFile(blits, iconPath(id));
  if (drawn.length === 0) {
    fail(
      `the frame to draw the produced icon ${assetPath(iconPath(id))}`,
      `${blitsUnderDir(blits, "icons").length} icon blits, none of them ${id}`,
    );
  }
  return drawn[drawn.length - 1];
}

/** Whether a frame drew the produced icon `id` at all. */
export function drewIcon(blits: readonly Blit[], id: OfferId): boolean {
  return blitsOfFile(blits, iconPath(id)).length > 0;
}

/** The slot an icon blit sits in: its box grown by {@link SLOT_PAD} each way. */
export function slotBox(h: Harness, blit: Blit): Box {
  const box = blitBoxOnStage(h, blit);
  const x = Math.max(0, box.x - SLOT_PAD);
  const y = Math.max(0, box.y - SLOT_PAD);
  return {
    x,
    y,
    w: Math.min(STAGE_W - x, box.w + 2 * SLOT_PAD),
    h: Math.min(STAGE_H - y, box.h + 2 * SLOT_PAD),
  };
}

/** A rectangle of the stage, as pixels. */
export function readBox(h: Harness, box: Box): PixelRect {
  return h.pixelRect(box.x, box.y, box.w, box.h);
}

/** Whether two stage rectangles share any area. */
export function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}

/* --------------------------- Marks in a region ---------------------------- */
//
// A COUNT of separate marks, where every reading above takes a width or an
// area. specs/ui.md places "the pips in a row outside the square the icon is
// drawn in and the only marks that row gains over a slot holding nothing", so a
// point can count the pips a slot draws against a slot holding nothing rather
// than only weigh the pixels two levels do not share. The table places the row
// against the icon and fixes nothing about where the row sits, so the row is
// located off the frames themselves and never off a fixed offset.

/** Which pixels of two equally shaped readings differ, one byte a pixel. */
export interface Mask {
  width: number;
  height: number;
  /** `1` where the two readings differ. */
  on: Uint8Array;
}

/** A rectangle of a reading, in the device pixels the reading was read in. */
export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A band of rows of a reading, both ends inclusive. */
export interface RowSpan {
  top: number;
  bottom: number;
}

/**
 * How small a connected region still counts as a mark a player sees: two
 * pixels.
 *
 * specs/ui.md has each held item show "one pip per level held" over a slot on a
 * `1280 x 720` stage, so a pip is a mark drawn to be counted at a glance and is
 * at least a couple of pixels across. Two pixels is below any such mark and
 * above the single pixel an antialiased edge leaves behind.
 */
export const MARK_MIN_AREA = 2;

/** Where two readings of one rectangle differ, pixel for pixel. */
export function differenceMask(a: PixelRect, b: PixelRect): Mask {
  sameShape(a, b);
  const on = new Uint8Array(a.width * a.height);
  for (let i = 0; i < on.length; i += 1) {
    on[i] = pixelDiffers(a, b, i) ? 1 : 0;
  }
  return { width: a.width, height: a.height, on };
}

/** `mask` with every pixel inside `box` cleared. */
export function withoutBox(mask: Mask, box: PixelBox): Mask {
  const on = new Uint8Array(mask.on);
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(mask.width, Math.ceil(box.x + box.w));
  const bottom = Math.min(mask.height, Math.ceil(box.y + box.h));
  for (let row = top; row < bottom; row += 1) {
    on.fill(0, row * mask.width + left, row * mask.width + right);
  }
  return { width: mask.width, height: mask.height, on };
}

/** The band of rows holding a changed pixel, or `null` where none do. */
export function rowSpanOf(mask: Mask): RowSpan | null {
  let top = -1;
  let bottom = -1;
  for (let row = 0; row < mask.height; row += 1) {
    const base = row * mask.width;
    for (let col = 0; col < mask.width; col += 1) {
      if (mask.on[base + col] === 0) continue;
      if (top < 0) top = row;
      bottom = row;
      break;
    }
  }
  return top < 0 ? null : { top, bottom };
}

/**
 * How many separate marks the changed pixels inside `span` form: connected
 * regions, counted through the eight neighbours a drawn shape holds together
 * through, and only those of at least `minArea` pixels, so a stray edge pixel
 * left by antialiasing is not a mark of its own.
 */
export function marksInRows(
  mask: Mask,
  span: RowSpan,
  minArea: number,
): number {
  const seen = new Uint8Array(mask.width * mask.height);
  const stack: number[] = [];
  const top = Math.max(0, span.top);
  const bottom = Math.min(mask.height - 1, span.bottom);
  let marks = 0;
  for (let row = top; row <= bottom; row += 1) {
    for (let col = 0; col < mask.width; col += 1) {
      const start = row * mask.width + col;
      if (mask.on[start] === 0 || seen[start] === 1) continue;
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let area = 0;
      while (stack.length > 0) {
        const at = stack.pop() as number;
        area += 1;
        const y = Math.floor(at / mask.width);
        const x = at - y * mask.width;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny < top || ny > bottom || nx < 0 || nx >= mask.width) continue;
            const next = ny * mask.width + nx;
            if (mask.on[next] === 0 || seen[next] === 1) continue;
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
      if (area >= minArea) marks += 1;
    }
  }
  return marks;
}

/** Where the stage rectangle `box` falls inside a reading taken over `read`. */
export function pixelBoxOf(h: Harness, read: Box, box: Box): PixelBox {
  const { scale } = h.viewport();
  return {
    x: (box.x - read.x) * scale,
    y: (box.y - read.y) * scale,
    w: box.w * scale,
    h: box.h * scale,
  };
}

/** The produced item `path` names, or `null` for a file that is no icon. */
function iconIdOf(path: string): OfferId | null {
  const prefix = `${assetPath("icons")}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".png")) return null;
  const id = path.slice(prefix.length, -".png".length);
  return ICON_IDS.find((known) => known === id) ?? null;
}

/**
 * How near two blits of one icon must fall to be one slot's picture rather
 * than two slots carrying the same item: half an icon.
 *
 * specs/assets.md fixes an icon at `24 x 24` and specs/ui.md draws each held
 * item's icon in its own slot, with "an empty slot visibly empty". Two blits of
 * one file whose centers fall within half an icon of each other are that one
 * slot drawn more than once, an outline under the icon or a highlight over it;
 * two that fall further apart are two slots showing the same item, and a slot
 * that owes a player nothing is then not empty.
 */
const SLOT_MERGE = ICON_SIZE / 2;

/**
 * The produced icons a frame drew, in slot order: reading order down the
 * frame, each row of slots left to right.
 *
 * specs/ui.md orders the slots and fixes no arrangement for them, so a row and
 * a grid both read the same way here. An icon drawn more than once in ONE PLACE
 * counts once, at the last blit of it, for the reason {@link iconBlit} states;
 * an icon drawn in two places counts twice, once per slot it fills, which is
 * what reads a slot filled with a repeat of a held item rather than left empty.
 */
export function iconsInSlotOrder(
  h: Harness,
  blits: readonly Blit[],
): OfferId[] {
  const placed: { id: OfferId; box: Box }[] = [];
  for (const blit of blitsUnderDir(blits, "icons")) {
    const id = iconIdOf(blit.id);
    if (id === null) continue;
    const box = blitBoxOnStage(h, blit);
    const at = placed.findIndex(
      (seen) =>
        seen.id === id &&
        Math.hypot(
          seen.box.x + seen.box.w / 2 - (box.x + box.w / 2),
          seen.box.y + seen.box.h / 2 - (box.y + box.h / 2),
        ) < SLOT_MERGE,
    );
    if (at < 0) placed.push({ id, box });
    else placed[at] = { id, box };
  }
  placed.sort((a, b) => {
    const ay = a.box.y + a.box.h / 2;
    const by = b.box.y + b.box.h / 2;
    const band = Math.min(a.box.h, b.box.h);
    return Math.abs(ay - by) < band ? a.box.x - b.box.x : ay - by;
  });
  return placed.map((entry) => entry.id);
}

/**
 * Whether the frame drew `phrase` inside some run of text, as its own words.
 *
 * specs/ui.md fixes the copy and no font, so `LEVEL 4` is read as those two
 * words in that order inside one run rather than as one spelling of the space
 * between them: case is ignored and any run of whitespace matches any other.
 * The phrase must sit on word boundaries, so a clock reading `0:05` is not
 * found inside `10:05` and a label reading `LEVEL 4` is not found inside
 * `LEVEL 42`, while copy a build sets around it still reads.
 */
export function drewPhrase(
  calls: readonly DrawCall[],
  phrase: string,
): boolean {
  const flatten = (text: string): string =>
    text.trim().replace(/\s+/g, " ").toLowerCase();
  const escaped = flatten(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`);
  return drawnText(calls).some((drawn) => pattern.test(flatten(drawn)));
}

/** Where a device pixel of the canvas falls in logical stage units. */
export function pointOnStage(
  h: Harness,
  x: number,
  y: number,
): { x: number; y: number } {
  const view = h.viewport();
  return {
    x: (x - view.offsetX) / view.scale,
    y: (y - view.offsetY) / view.scale,
  };
}

/**
 * The frame drew `phrase`, or the point fails with every run of text it drew,
 * which is what says whether the copy is missing or merely spelled otherwise.
 */
export function assertDrewPhrase(
  calls: readonly DrawCall[],
  phrase: string,
  context?: string,
): void {
  if (drewPhrase(calls, phrase)) return;
  const wanted = `a run of text reading ${JSON.stringify(phrase)}`;
  fail(
    context === undefined ? wanted : `${wanted} (${context})`,
    drawnText(calls),
  );
}

/** A copy of the frame currently on the canvas, kept for the evidence. */
export function keepFrame(h: Harness): Canvas {
  const kept = createCanvas(h.canvas.width, h.canvas.height);
  kept.getContext("2d").drawImage(h.canvas, 0, 0);
  return kept;
}

/** The gap between two kept frames in a stack, in device pixels. */
const STACK_GAP = 4;

/**
 * Keep several frames as the review item's `outputId` output, stacked top to
 * bottom in the order they were drawn.
 *
 * A point whose item reads a bar "at two fills" or a clock "at four ticks" has
 * evidence that is several pictures, and an output is one file, so the frames
 * are laid out as one picture rather than one of them being chosen.
 */
export function captureFrames(
  frames: readonly Canvas[],
  outputId: string,
): void {
  if (frames.length === 0) return;
  const width = Math.max(...frames.map((frame) => frame.width));
  const height =
    frames.reduce((total, frame) => total + frame.height, 0) +
    STACK_GAP * (frames.length - 1);
  const sheet = createCanvas(width, height);
  const into = sheet.getContext("2d");
  let y = 0;
  for (const frame of frames) {
    into.drawImage(frame, 0, y);
    y += frame.height + STACK_GAP;
  }
  captureCanvas(sheet, outputId);
}
