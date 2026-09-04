// presentation/sigil-glyphs-drawn-from-produced-files — twelve sigils on the
// field, twelve produced glyphs, each on the sigil it was produced for.
//
// THE RULE. "Every mote, filament, glyph, hub, gripper, mount, and aperture on
// screen is a produced sprite" (`specs/assets.md`, Genuinely produced), and the
// Sigil glyphs row of The sprites names the files: "`assets/sprites/sigils/<kind>.png`,
// one for each of the twelve transforming sigils of `PARTS`", on a `48 x 48`
// canvas, drawn "upright and centered on the sigil's anchor hex".
// `specs/parts.md` names the twelve: "`bind` through `void` are the twelve
// transforming sigils", and its Presentation asks for what one file each makes
// possible: "the twelve transforming sigils read apart from one another".
//
// WHAT SETTLES WHICH SOURCE A DRAW NAMED IS ITS OWN PIXELS, never a path — a
// bundler is free to inline a produced PNG as a `data:` URI, and that is still the
// committed file. So each source is read back through `Harness.imagePixels` and
// compared with the twelve committed files.
//
// WHAT IT READS. All twelve sigils are posed at once, and for each of them the
// frame must draw that kind's own file, landing nearer that sigil's anchor hex than
// any of the other eleven anchors. The anchors are at least `HEX_PITCH` (`48`)
// apart, so that is a wide berth rather than a placement rule — where exactly a
// glyph lands is `sigil-glyph-placed-on-its-anchor`. What it forecloses is a build
// that drew all twelve files somewhere and put them on the wrong sigils.
//
// THE CONFIGURATION. `BARE` opened as a bare run — the completion switch held off,
// a live run, an EMPTY FIELD — with a machine of exactly the twelve transforming
// sigils, each at rotation `0`, on anchors whose footprints are pairwise disjoint
// and wholly on the field, as `specs/parts.md`'s placement rules require. Nothing
// else is placed and no mote is on the field, so every glyph in the frame is one of
// the twelve.
//
// THE EVIDENCE is the field carrying all twelve, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { SIGIL_GLYPH_PATHS, TRANSFORMING_SIGILS } from "../constants";
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
import { SIGIL_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";

/**
 * An anchor for each of the twelve, in `TRANSFORMING_SIGILS` order.
 *
 * The footprints `specs/sigils.md` gives them are pairwise disjoint at these
 * anchors and every hex of every one is on the field, which is what
 * `specs/parts.md`'s placement rules require of the machine as a whole. No two
 * anchors are the same hex, so the nearest anchor to a point is unambiguous.
 */
const ANCHORS: Readonly<Record<(typeof TRANSFORMING_SIGILS)[number], Hex>> = {
  bind: at(4, 0),
  manifold: at(0, -4),
  triune: at(1, 2),
  sunder: at(-5, 2),
  wane: at(-2, 5),
  mirror: at(-4, 1),
  ascend: at(-3, -2),
  conjoin: at(0, 4),
  eclipse: at(-5, 0),
  confluence: at(-4, 4),
  dispersion: at(4, -4),
  void: at(0, 0),
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws each of the twelve sigils with the glyph produced for it", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      TRANSFORMING_SIGILS.map((kind) =>
        sigilPart(kind, ANCHORS[kind].q, ANCHORS[kind].r, 0),
      ),
    ),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "glyphs");

  assertLength(
    (await h.snapshot()).editor.parts,
    TRANSFORMING_SIGILS.length,
    "the parts the machine holds, so the reading below is about twelve posed sigils",
  );

  const readings = await decodeProduced(SIGIL_SPRITES);
  const glyphs = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${SIGIL_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  /** The sigil whose anchor hex a point landed nearest. */
  const nearestSigil = (x: number, y: number): string => {
    let best: string = TRANSFORMING_SIGILS[0];
    let away = Number.POSITIVE_INFINITY;
    for (const kind of TRANSFORMING_SIGILS) {
      const off = distance({ x, y }, hexCenter(ANCHORS[kind]));
      if (off < away) {
        best = kind;
        away = off;
      }
    }
    return best;
  };

  // Every glyph the frame drew: which of the twelve files it is, and which of the
  // twelve sigils it landed on.
  const drawn = new Map<string, string[]>();
  for (const draw of imageDraws(calls)) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const glyph = glyphs.find((sprite) => sameAsDrawn(sprite, pixels));
    if (glyph === undefined) continue;
    const on = drawn.get(glyph.file) ?? [];
    on.push(nearestSigil(draw.cx, draw.cy));
    drawn.set(glyph.file, on);
  }

  for (const kind of TRANSFORMING_SIGILS) {
    const file = assetFile(SIGIL_GLYPH_PATHS[kind]);
    const on = drawn.get(file);
    if (on === undefined) {
      fail(
        `an image draw of ${file}, rather than a glyph drawn in code`,
        "the frame drew that file nowhere",
      );
    }
    assertEqual(
      on.includes(kind) ? kind : on.join(", "),
      kind,
      `the sigil ${file} was drawn on, of the twelve posed`,
    );
  }
});
