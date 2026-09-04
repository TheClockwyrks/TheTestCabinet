// presentation/instruction-glyphs-drawn-from-produced-files — a written cell shows
// the glyph produced for the instruction it holds.
//
// THE RULE. "Each cell shows its instruction as the produced glyph
// `specs/assets.md` names for it, drawn at native size, with the ten instructions
// of `specs/instructions.md` distinguishable at `TAPE_CELL_W` (`24`)"
// (`specs/editor.md`, The tape panel). `specs/assets.md`'s Instruction glyphs row
// names those files: "`assets/sprites/instructions/<name>.png`, one for each of the
// ten names in `INSTRUCTIONS`", on a `24 x 24` canvas, "centered in its tape cell";
// and Genuinely produced closes it: "Every mote, filament, glyph, hub, gripper,
// mount, and aperture on screen is a produced sprite." So a letter or a word the
// render paints in the cell is not it.
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path — a
// bundler is free to inline a produced PNG as a `data:` URI, and that is still the
// committed file. So each source is read back through `Harness.imagePixels` and
// compared with the ten committed files.
//
// WHAT IT READS. One tape holding all ten instructions, one per cell in
// `INSTRUCTIONS` order, and for each of them the frame must draw that name's own
// file, landing nearer that name's cell than any of the other nine. Cells are
// `TAPE_CELL_W` (`24`) apart, so that is a wide berth rather than a placement rule
// — where exactly a glyph lands inside its cell is
// `instruction-glyph-placed-in-its-cell`. What it forecloses is a build that drew
// all ten files and put them in the wrong columns.
//
// THE CONFIGURATION. `BARE` opened in the editor with ONE arm on it, so the panel
// holds exactly one row, and that row's tape written from column `0` with the ten
// names of `INSTRUCTIONS` in order. The cursor is cleared, so `firstRow` and
// `firstCol` are both `0` (`specs/editor.md` derives both from the cursor) and the
// ten rectangles read are the unscrolled ones the panel fixes. No run is started,
// so nothing on the field is moving.
//
// THE EVIDENCE is the tape row holding all ten, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { INSTRUCTIONS, INSTRUCTION_GLYPH_PATHS } from "../constants";
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
} from "../harness";
import { INSTRUCTION_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each of the ten instructions with the glyph produced for it", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await writeTape(h, arm, INSTRUCTIONS);
  await h.debug.setCursor(null, 0);
  await h.advance(1);
  await captureStill(h, "tape");

  assertLength(
    (await h.snapshot()).editor.parts[0]?.tape ?? [],
    INSTRUCTIONS.length,
    "the length of the row's tape, so the reading below is about ten written cells",
  );

  const readings = await decodeProduced(INSTRUCTION_SPRITES);
  const glyphs = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${INSTRUCTION_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  /** The instruction whose cell rectangle a point landed nearest. */
  const nearestCell = (x: number, y: number): string => {
    let best: string = INSTRUCTIONS[0];
    let away = Number.POSITIVE_INFINITY;
    for (const [column, name] of INSTRUCTIONS.entries()) {
      const off = distance({ x, y }, regionCenter(tapeCell(0, column)));
      if (off < away) {
        best = name;
        away = off;
      }
    }
    return best;
  };

  const drawn = new Map<string, string[]>();
  for (const draw of imageDraws(await h.lastCalls())) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const glyph = glyphs.find((sprite) => sameAsDrawn(sprite, pixels));
    if (glyph === undefined) continue;
    const on = drawn.get(glyph.file) ?? [];
    on.push(nearestCell(draw.cx, draw.cy));
    drawn.set(glyph.file, on);
  }

  for (const name of INSTRUCTIONS) {
    const file = assetFile(INSTRUCTION_GLYPH_PATHS[name]);
    const on = drawn.get(file);
    if (on === undefined) {
      fail(
        `an image draw of ${file}, rather than a letter drawn in code`,
        "the frame drew that file nowhere",
      );
    }
    assertEqual(
      on.includes(name) ? name : on.join(", "),
      name,
      `the cell ${file} was drawn in, of the ten written`,
    );
  }
});
