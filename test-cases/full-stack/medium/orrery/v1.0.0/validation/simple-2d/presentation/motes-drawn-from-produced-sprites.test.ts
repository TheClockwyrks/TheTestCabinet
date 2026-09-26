// presentation/motes-drawn-from-produced-sprites — a mote on the field is an
// image draw of a file this build produced, rather than a shape drawn in code.
//
// THE RULE. "Every mote, filament, glyph, hub, gripper, mount, and aperture on
// screen is a produced sprite" (`specs/assets.md`, Genuinely produced), and the
// Motes row of The sprites names what a mote is drawn from:
// "`assets/sprites/motes/<type>.png`, one for each of the fifteen names in
// `MOTES`", on a `44 x 44` canvas, "centered on every mote's position". So the
// picture under a mote is one of those fifteen committed files, put on the canvas
// with an image draw, and a disc or a glyph the render paints in code is not it.
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path. "A
// bundler is free to inline a small produced PNG as a `data:` URI, and that is
// still the committed file" (`drawing.ts`), so this reads the source back through
// `Harness.imagePixels` and holds the point when those bytes are the bytes of one
// of the fifteen files on disk.
//
// THE CONFIGURATION. `BARE` opened as a bare run — reset, the posed challenge, an
// empty machine, the completion switch held off, a live run, an EMPTY FIELD —
// with one `sol` spawned back on the origin and nothing else anywhere. So the
// only thing on the field is the mote, and the draw read is that mote's.
//
// WHAT IT DOES NOT DECIDE. WHICH of the fifteen files a type is drawn with is
// `each-mote-type-draws-its-own-sprite`; where the draw lands and how large it is
// is `mote-sprite-at-native-size`. This point decides one thing in one direction:
// that a mote is painted from a produced file at all.
//
// THE EVIDENCE is the frame the reading was taken off, so the sprite the verdict
// is about is the picture a reviewer sees — and it is written before the
// assertions, so a FAILING check leaves it too.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNotNull, fail } from "../assert";
import { MOTE_R } from "../constants";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imagesNear,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";
import { MOTE_SPRITES } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the mote with an image draw of one of the fifteen produced files", async () => {
  await openBareRun(h, { challenge: BARE });
  await spawnMote(h, ORIGIN, "sol");

  const calls = await h.frameCalls();
  await captureStill(h, "motes");

  // Every mote's paint stays inside `MOTE_R` (`22`) of its center
  // (`specs/assets.md`, The art bar), and adjacent hex centers are `HEX_PITCH`
  // (`48`) apart, so a draw centred within that radius belongs to this mote.
  const near = imagesNear(calls, hexCenter(ORIGIN), MOTE_R);
  assertGreaterThan(
    near.length,
    0,
    "image draws the frame centred within MOTE_R (22) of the mote's position",
  );

  const readings = await decodeProduced(MOTE_SPRITES);
  const sprites = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${MOTE_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  let painted: string | null = null;
  for (const draw of near) {
    const drawn = await h.imagePixels(draw.image.id);
    if (drawn === null) continue;
    const found = sprites.find((sprite) => sameAsDrawn(sprite, drawn));
    if (found !== undefined) {
      painted = found.file;
      break;
    }
  }

  assertNotNull(
    painted,
    "the produced file under assets/sprites/motes/ whose pixels the frame drew on the mote's position, rather than a shape painted in code",
  );
});
