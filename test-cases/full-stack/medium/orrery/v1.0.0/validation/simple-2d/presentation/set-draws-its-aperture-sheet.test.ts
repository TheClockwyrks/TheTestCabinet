// presentation/set-draws-its-aperture-sheet — a set on the field paints a frame of
// the SET sheet on its anchor hex.
//
// THE RULE, from `specs/assets.md`'s sheet table and the sentence under it: "Set
// aperture | `assets/sprites/apertures/set/0.png` to `5.png` | `6` | `48 x 48`",
// and "Each rise and EACH SET on the field draws frame
// `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` OF ITS OWN
// SHEET, CENTERED ON ITS ANCHOR HEX, under the pattern the build draws in code".
// The preamble fixes the size: every sprite is "authored at the canvas its table
// row states and drawn at that size in logical units, centered on the thing it
// depicts, so nothing is scaled at draw time".
//
// WHICH SHEET IS DRAWN IS DECIDED BY PIXELS, NEVER BY A PATH. A bundler may inline
// a produced PNG as a `data:` URI and that is still the committed file.
// `Harness.imagePixels` hands back the source a frame drew at its own natural size
// and `sameAsDrawn` compares it against the twelve committed aperture frames — the
// set sheet's six and the rise sheet's six — so the verdict names WHICH sheet the
// set drew from, which is the whole of "its own sheet".
//
// THE WORLD IS ONE SET IN THE EDITOR. The rule says "on the field", not "in a run",
// and no run is started here so nothing spawns, moves or is consumed. `BARE`'s one
// product is a single `sol` on `(0, 0)` and it does not repeat, so the set's
// footprint is the one anchor hex (`specs/parts.md`, Rises and sets) and no second
// hex of it can be mistaken for the anchor.
//
// THE VERDICT. One sprite from the set sheet is drawn, centered on the set's anchor
// hex, at its native `48 x 48`; and no frame the rise sheet alone holds is drawn
// anywhere on that frame. The rule fixes that "no two frames of a sheet are the
// same image" and fixes nothing between the two sheets, so a drawn frame that
// both sheets hold is the set's own sheet drawn.

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
  placeSet,
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

it("draws a frame of the set sheet on the set's anchor hex", async () => {
  await openChallengeDocument(h, BARE);
  const set = await placeSet(h, 0, ORIGIN, 0);

  await h.advance(1);
  await captureStill(h, "set");

  const posed = await h.snapshot();
  assertEqual(
    partById(posed, set)?.kind,
    "set",
    "one set stands on the field, and nothing else is placed",
  );
  assertLength(posed.editor.parts, 1, "the machine is that set alone");

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
    // The SET sheet is asked first. `specs/assets.md` fixes that no two frames
    // OF A SHEET are the same image and says nothing of the two sheets against
    // each other, so a build whose set frames are its rise frames in another
    // order is within the rule; a frame both sheets hold is then the set's own
    // sheet drawn, and only a frame the set sheet does not hold reads as the rise
    // sheet.
    const setFrame = sprites
      .slice(RISE_SPRITES.length)
      .findIndex((sprite) => sameAsDrawn(sprite, pixels));
    const riseFrame =
      setFrame >= 0
        ? -1
        : sprites
            .slice(0, RISE_SPRITES.length)
            .findIndex((sprite) => sameAsDrawn(sprite, pixels));
    if (setFrame < 0 && riseFrame < 0) continue;
    drawn.push({
      sheet: setFrame >= 0 ? "set" : "rise",
      x: draw.cx,
      y: draw.cy,
      size: Math.round(Math.abs(draw.dw)),
    });
  }

  assertLength(
    drawn,
    1,
    "a placed set paints one frame of an aperture sheet, and one alone",
  );
  const aperture = drawn[0];
  assertEqual(
    aperture?.sheet,
    "set",
    "and the frame it paints comes from assets/sprites/apertures/set/, its own sheet",
  );
  assertLessThanOrEqual(
    distance({ x: aperture?.x ?? 0, y: aperture?.y ?? 0 }, hexCenter(ORIGIN)),
    ON_POINT,
    "centered on the set's anchor hex",
  );
  assertEqual(
    aperture?.size,
    APERTURE_SPRITE_SIZE,
    "drawn at its native 48 x 48 canvas, so nothing is scaled at draw time",
  );
});
