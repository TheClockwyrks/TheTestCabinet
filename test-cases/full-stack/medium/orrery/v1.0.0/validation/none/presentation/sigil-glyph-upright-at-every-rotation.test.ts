// presentation/sigil-glyph-upright-at-every-rotation — the footprint turns with the
// rotation; the glyph on it does not.
//
// THE RULE. The Sigil glyphs row of `specs/assets.md` (The sprites) draws a glyph
// "upright and centered on the sigil's anchor hex". It is the only row of that
// table whose Drawn column says "upright" without naming an angle to turn to — the
// arm hub is "turned to its first spoke", the wheel hub "turned to the wheel's live
// rotation", the strip "turned to the angle from the first to the second" — so a
// sigil's rotation, which `specs/parts.md` says "turns the part's shape by 60 degree
// steps", moves its footprint and leaves its picture alone.
//
// WHAT IT READS. The rotation in force at each glyph's draw, for six sigils of one
// kind posed at rotations `0` through `5`. All six are upright, so a build that
// turned the glyph with the footprint is read at five of the six.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with six `conjoin` sigils, one per
// rotation, on six anchors around the field. `conjoin`'s footprint is three hexes,
// so a rotation genuinely moves it; the anchors are four hexes apart, so the
// footprints are pairwise disjoint and wholly on the field at every rotation, as
// `specs/parts.md`'s placement rules require. Nothing else is placed and no mote is
// on the field.
//
// THE TOLERANCE is one degree, which over the `48` units a glyph's canvas spans
// moves a corner by less than one logical unit — the screen pixel `specs/assets.md`
// (Scale) makes a logical unit at the reference fit.
//
// THE EVIDENCE is the frame holding all six, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertLength, fail } from "../assert";
import { HEX_PITCH, SIGIL_GLYPH_PATHS } from "../constants";
import { at, distance, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import { sigilPart, solution } from "../formats";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  type Harness,
} from "../harness";
import { assetFile } from "../assets/files";
import { decodeSprite, sameAsDrawn } from "../assets/sprites";

/** One degree (see the header). */
const ANGLE_TOLERANCE = 1;

/** The sigil posed six times: three footprint hexes, so a rotation moves it. */
const KIND = "conjoin";

/**
 * One anchor per rotation `0` to `5`, four hexes apart on a ring inside the field.
 *
 * Four apart is two more than a `conjoin` footprint reaches, so the six are
 * pairwise disjoint however each is turned, and every anchor is four hexes from the
 * centre of a field of radius `FIELD_R` (`5`), so every footprint hex is on it.
 */
const ANCHORS: readonly Hex[] = [
  at(0, -4),
  at(4, -4),
  at(4, 0),
  at(0, 4),
  at(-4, 4),
  at(-4, 0),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the same upright glyph at each of the six rotations", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ANCHORS.map((anchor, rotation) =>
        sigilPart(KIND, anchor.q, anchor.r, rotation),
      ),
    ),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "rotations");

  assertLength(
    (await h.snapshot()).editor.parts,
    ANCHORS.length,
    "the parts the machine holds, so the reading below is about six posed sigils",
  );

  const file = assetFile(SIGIL_GLYPH_PATHS[KIND]);
  const read = await decodeSprite(file);
  if (read.sprite === null) fail(`a decoded ${file}`, read.reason);

  // Every draw of that one file, with where it landed: the glyph read for each
  // rotation is the one nearest that rotation's anchor hex.
  const drawn: { x: number; y: number; angle: number }[] = [];
  for (const draw of imageDraws(calls)) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null || !sameAsDrawn(read.sprite, pixels)) continue;
    drawn.push({ x: draw.cx, y: draw.cy, angle: draw.angle });
  }

  for (const [rotation, anchor] of ANCHORS.entries()) {
    const centre = hexCenter(anchor);
    let nearest: { away: number; angle: number } | null = null;
    for (const glyph of drawn) {
      const away = distance({ x: glyph.x, y: glyph.y }, centre);
      if (nearest === null || away < nearest.away) {
        nearest = { away, angle: glyph.angle };
      }
    }
    if (nearest === null || nearest.away > HEX_PITCH / 2) {
      fail(
        `an image draw of ${file} within half a hex pitch of the anchor of the sigil at rotation ${rotation}`,
        nearest === null
          ? "the frame drew that file nowhere"
          : `the nearest landed ${nearest.away.toFixed(2)} away`,
      );
    }
    assertAngleNear(
      nearest.angle,
      0,
      ANGLE_TOLERANCE,
      `the degrees the glyph on the sigil at rotation ${rotation} was turned to`,
    );
  }
});
