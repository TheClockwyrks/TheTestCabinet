// presentation/instruction-glyph-placed-in-its-cell — the glyph is `24 x 24` in the
// middle of its own column, not stretched to the row and not over its neighbour.
//
// THE RULE. "Each cell shows its instruction as the produced glyph
// `specs/assets.md` names for it, drawn at native size" (`specs/editor.md`, The
// tape panel), and `specs/assets.md`'s Instruction glyphs row states the canvas —
// `24 x 24` — and where it goes: "centered in its tape cell". Scale says what
// native size means: "Every sprite is authored at the canvas its table row states
// and drawn at that size in logical units, centered on the thing it depicts, so
// nothing is scaled at draw time."
//
// WHERE THE CELL IS. `specs/editor.md` fixes the panel's geometry: a row's columns
// "begin at `TRAY_REGION_W + TAPE_X0` (`312`)", `TAPE_CELL_W` is `24` and
// `TAPE_ROW_H` is `28`, and "Visible column `u` spans `x` `TRAY_REGION_W + TAPE_X0 +
// u * TAPE_CELL_W` onward and shows cell `firstCol + u`", within "Visible row `v`
// ... spans `y` `TAPE_Y0 + v * TAPE_ROW_H` to `TAPE_Y0 + (v + 1) * TAPE_ROW_H`". So
// a cell is `24` wide and `28` high, and the glyph is centred in it — which is why
// a build that scaled the glyph to the row height is drawing `28` where `24`
// belongs, and one that centred it on a column edge is spilling into the next
// column.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm on it, so the panel
// holds exactly one row, and that row's tape written as three instructions from
// column `0`. The cell read is column `1`, the middle one, so it has a written
// neighbour on each side and a glyph that spilled either way lands in one. The
// cursor is cleared, so `firstRow` and `firstCol` are both `0` (`specs/editor.md`
// derives both from the cursor) and the rectangle read is the unscrolled one.
//
// THE VERDICT is read off the destination rectangle the draw named, mapped through
// the transform in force at it: its centre against the middle of the cell
// rectangle, and its two sides against `INSTRUCTION_GLYPH_SIZE` (`24`).
//
// THE TOLERANCE is one logical unit, which `specs/assets.md` (Scale) makes one
// screen pixel at the reference `1280`-pixel fit.
//
// THE EVIDENCE is the frame the measurement was taken off, written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import {
  INSTRUCTION_GLYPH_PATHS,
  INSTRUCTION_GLYPH_SIZE,
  type InstructionName,
} from "../constants";
import { distance, regionCenter, tapeCell } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  openChallengeDocument,
  placePart,
  writeTape,
  type Harness,
  type ImageDraw,
} from "../harness";
import { assetFile } from "../assets/files";
import { decodeSprite, sameAsDrawn } from "../assets/sprites";

/** One logical unit: one screen pixel at the reference fit (`specs/assets.md`). */
const PLACEMENT_TOLERANCE = 1;

/** The tape written, and the column measured: the middle one, with a neighbour each side. */
const TAPE: readonly InstructionName[] = ["grab", "drop", "rotate-cw"];
const COLUMN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the glyph as a 24 x 24 square centred in its own cell rectangle", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await writeTape(h, arm, TAPE);
  await h.debug.setCursor(null, 0);
  await h.advance(1);
  await captureStill(h, "cell");

  const name = TAPE[COLUMN];
  const file = assetFile(INSTRUCTION_GLYPH_PATHS[name]);
  const read = await decodeSprite(file);
  if (read.sprite === null) fail(`a decoded ${file}`, read.reason);

  const centre = regionCenter(tapeCell(0, COLUMN));
  let painted: ImageDraw | null = null;
  let away = Number.POSITIVE_INFINITY;
  for (const draw of imageDraws(await h.lastCalls())) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null || !sameAsDrawn(read.sprite, pixels)) continue;
    const off = distance({ x: draw.cx, y: draw.cy }, centre);
    if (off < away) {
      painted = draw;
      away = off;
    }
  }
  if (painted === null) {
    fail(`an image draw of ${file} somewhere in the frame`, "no such draw");
  }

  assertNear(
    painted.cx,
    centre.x,
    PLACEMENT_TOLERANCE,
    `the stage x the glyph is centred on, against the middle of cell ${COLUMN}'s column`,
  );
  assertNear(
    painted.cy,
    centre.y,
    PLACEMENT_TOLERANCE,
    `the stage y the glyph is centred on, against the middle of the row's cell rectangle`,
  );
  assertNear(
    Math.abs(painted.dw),
    INSTRUCTION_GLYPH_SIZE,
    PLACEMENT_TOLERANCE,
    "the width in logical units the glyph was drawn across",
  );
  assertNear(
    Math.abs(painted.dh),
    INSTRUCTION_GLYPH_SIZE,
    PLACEMENT_TOLERANCE,
    "the height in logical units the glyph was drawn across",
  );
});
