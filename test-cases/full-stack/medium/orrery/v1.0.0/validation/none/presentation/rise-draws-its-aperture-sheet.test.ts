// presentation/rise-draws-its-aperture-sheet — a rise on the field paints a frame
// of the RISE sheet on its anchor hex.
//
// THE RULE, from `specs/assets.md`'s sheet table and the sentence under it: "Rise
// aperture | `assets/sprites/apertures/rise/0.png` to `5.png` | `6` | `48 x 48`",
// and "EACH RISE and each set on the field draws frame
// `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` OF ITS OWN
// SHEET, CENTERED ON ITS ANCHOR HEX, under the pattern the build draws in code".
// The preamble fixes the size it is drawn at: every sprite is "authored at the
// canvas its table row states and drawn at that size in logical units, centered on
// the thing it depicts, so nothing is scaled at draw time".
//
// WHICH SHEET IS DRAWN IS DECIDED BY PIXELS, NEVER BY A PATH. A bundler may inline
// a produced PNG as a `data:` URI and that is still the committed file.
// `Harness.imagePixels` hands back the source a frame drew at its own natural size
// and `sameAsDrawn` compares it against the twelve committed aperture frames — the
// rise sheet's six and the set sheet's six — so the verdict names WHICH sheet the
// rise drew from, which is the whole of "its own sheet".
//
// THE WORLD IS ONE RISE IN THE EDITOR. The rule says "on the field", not "in a
// run", and no run is started here so nothing spawns, moves or is consumed: the
// only thing on the field is the rise whose drawing is under test. Its reagent is
// `BARE`'s single `sol` on `(0, 0)`, so its footprint is the one anchor hex
// (`specs/parts.md`) and no second hex of it can be mistaken for the anchor.
//
// THE VERDICT. One sprite from the rise sheet is drawn, centered on the rise's
// anchor hex, at its native `48 x 48`; and no frame of the SET sheet is drawn
// anywhere on that frame.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertLessThanOrEqual,
  fail,
} from "../assert";
import { APERTURE_SPRITE_SIZE } from "../constants";
import { distance, hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  openChallengeDocument,
  partById,
  placeRise,
  type Harness,
} from "../harness";
import { RISE_SPRITES, SET_SPRITES } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/** How near a sprite's centre must land to count as drawn on a hex. */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a frame of the rise sheet on the rise's anchor hex", async () => {
  await openChallengeDocument(h, BARE);
  const rise = await placeRise(h, 0, ORIGIN, 0);

  await h.advance(1);
  await captureStill(h, "rise");

  const posed = await h.snapshot();
  assertEqual(
    partById(posed, rise)?.kind,
    "rise",
    "one rise stands on the field, and nothing else is placed",
  );
  assertLength(posed.editor.parts, 1, "the machine is that rise alone");

  const sheets = [...RISE_SPRITES, ...SET_SPRITES];
  const readings = await decodeProduced(sheets);
  const sprites = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(
        `a decoded ${sheets[index]?.label ?? "aperture frame"}`,
        read.reason,
      );
    }
    return read.sprite;
  });

  const drawn: { sheet: "rise" | "set"; x: number; y: number; size: number }[] =
    [];
  for (const draw of imageDraws(await h.lastCalls())) {
    if (draw.image.width !== APERTURE_SPRITE_SIZE) continue;
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const found = sprites.findIndex((sprite) => sameAsDrawn(sprite, pixels));
    if (found < 0) continue;
    drawn.push({
      sheet: found < RISE_SPRITES.length ? "rise" : "set",
      x: draw.cx,
      y: draw.cy,
      size: Math.round(Math.abs(draw.dw)),
    });
  }

  assertLength(
    drawn,
    1,
    "a placed rise paints one frame of an aperture sheet, and one alone",
  );
  const aperture = drawn[0];
  assertEqual(
    aperture?.sheet,
    "rise",
    "and the frame it paints comes from assets/sprites/apertures/rise/, its own sheet",
  );
  assertLessThanOrEqual(
    distance({ x: aperture?.x ?? 0, y: aperture?.y ?? 0 }, hexCenter(ORIGIN)),
    ON_POINT,
    "centered on the rise's anchor hex",
  );
  assertEqual(
    aperture?.size,
    APERTURE_SPRITE_SIZE,
    "drawn at its native 48 x 48 canvas, so nothing is scaled at draw time",
  );
});
