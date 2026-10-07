// presentation/sigil-glyph-placed-on-its-anchor — the glyph covers the `48 x 48`
// square its anchor hex sits in the middle of, and no other hex of its footprint.
//
// THE RULE. "Every sprite is authored at the canvas its table row states and drawn
// at that size in logical units, centered on the thing it depicts, so nothing is
// scaled at draw time" (`specs/assets.md`, Scale). The Sigil glyphs row states the
// canvas — `48 x 48` — and what the glyph is centred on: "upright and centered on
// the sigil's anchor hex". `specs/parts.md` says which hex that is: "Every placed
// arm, wheel, and sigil carries an anchor hex and a rotation `0` to `5`", and the
// footprint is "its pattern's hexes placed at that pose", of which the anchor is
// one. `specs/field.md` fixes where that hex's centre falls on the stage.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with one `void` sigil at `(1, -1)`,
// rotation `0`, and nothing else. `void` is chosen because its footprint is the
// widest of the twelve — "the maw and its six rim hexes" — so a glyph pushed onto
// another footprint hex has six wrong hexes to land on, each `HEX_PITCH` (`48`) from
// the right one. The anchor is `(1, -1)` rather than the origin because neither of
// its stage coordinates is the field's centre: `hexX(1, -1)` is `640` and
// `hexY(1, -1)` is `304 - 48 * sqrt(3) / 2`, which is not a whole number.
//
// THE VERDICT is read off the destination rectangle the draw named, mapped through
// the transform in force at it: its centre against the anchor hex's centre, and its
// two sides against `SIGIL_GLYPH_SIZE` (`48`).
//
// THE TOLERANCE is one logical unit, which `specs/assets.md` (Scale) makes one
// screen pixel at the reference `1280`-pixel fit.
//
// THE EVIDENCE is the frame the measurement was taken off, written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import { SIGIL_GLYPH_PATHS, SIGIL_GLYPH_SIZE } from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE } from "../fixtures";
import { sigilPart, solution } from "../formats";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  type Harness,
  type ImageDraw,
} from "../harness";
import { assetFile } from "../assets/files";
import { decodeSprite, sameAsDrawn } from "../assets/sprites";

/** One logical unit: one screen pixel at the reference fit (`specs/assets.md`). */
const PLACEMENT_TOLERANCE = 1;

/** The sigil posed, and its anchor hex. */
const KIND = "void";
const ANCHOR = at(1, -1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the sigil's glyph as a 48 x 48 square centred on its anchor hex", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart(KIND, ANCHOR.q, ANCHOR.r, 0)]),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "anchor");

  const file = assetFile(SIGIL_GLYPH_PATHS[KIND]);
  const read = await decodeSprite(file);
  if (read.sprite === null) fail(`a decoded ${file}`, read.reason);

  const centre = hexCenter(ANCHOR);
  let painted: ImageDraw | null = null;
  let away = Number.POSITIVE_INFINITY;
  for (const draw of imageDraws(calls)) {
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
    `the stage x the glyph is centred on, against hexX(${ANCHOR.q}, ${ANCHOR.r})`,
  );
  assertNear(
    painted.cy,
    centre.y,
    PLACEMENT_TOLERANCE,
    `the stage y the glyph is centred on, against hexY(${ANCHOR.q}, ${ANCHOR.r})`,
  );
  assertNear(
    Math.abs(painted.dw),
    SIGIL_GLYPH_SIZE,
    PLACEMENT_TOLERANCE,
    "the width in logical units the glyph was drawn across",
  );
  assertNear(
    Math.abs(painted.dh),
    SIGIL_GLYPH_SIZE,
    PLACEMENT_TOLERANCE,
    "the height in logical units the glyph was drawn across",
  );
});
