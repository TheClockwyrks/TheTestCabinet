// presentation/motes-drawn-over-filament-ends — the strip goes down first and the
// two motes go over its ends.
//
// THE RULE. The Filaments row of `specs/assets.md` (The sprites) ends "with the
// motes drawn over its ends". A strip spans `HEX_PITCH` (`48`) and a mote's form
// reaches `MOTE_R` (`22`) from its centre, so the strip's two ends lie under the
// motes it joins; which of the two is composited last is what decides whether a
// player sees the mote or the strip there. `specs/field.md`'s Presentation asks for
// the same thing from the other side: "A filament visibly joins the centers of the
// two motes it links", and a mote covered by its own filament is not joined by it,
// it is hidden under it.
//
// WHAT IT READS. The ORDER of the frame's image draws, which is the order they were
// composited in: the strip's draw comes before each mote's. That is the reading the
// rule states, and it holds whatever the two pictures happen to be — a check that
// sampled a pixel at the end of the strip would be deciding what the two sprites
// were drawn as rather than what order they went down in.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with two motes spawned back on
// `(0, 0)` and `(1, 0)` and one filament of weight `1` between them, and nothing
// else. The two draws are told apart by where they landed, since both motes are the
// same type and so are drawn from one file.
//
// THE EVIDENCE is the frame the order was read off, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, fail } from "../assert";
import { MOTE_R, MOTE_SPRITE_PATHS } from "../constants";
import { at, distance, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  spawnConstellation,
  type Harness,
} from "../harness";
import { FILAMENT_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, decodeSprite, sameAsDrawn } from "../assets/sprites";

/** The two hexes the filament joins, and the type of mote on each. */
const FIRST = at(0, 0);
const SECOND = at(1, 0);
const TYPE = "dust";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("composites the strip before each of the two motes it joins", async () => {
  await openBareRun(h, { challenge: BARE });
  await spawnConstellation(
    h,
    [
      { hex: FIRST, type: TYPE },
      { hex: SECOND, type: TYPE },
    ],
    [{ a: 0, b: 1, weight: 1 }],
  );

  const calls = await h.frameCalls();
  await captureStill(h, "order");

  const moteFile = assetFile(MOTE_SPRITE_PATHS[TYPE]);
  const moteRead = await decodeSprite(moteFile);
  if (moteRead.sprite === null) fail(`a decoded ${moteFile}`, moteRead.reason);
  const stripReadings = await decodeProduced(FILAMENT_SPRITES);
  const strips = stripReadings.map((read, index) => {
    if (read.sprite === null) {
      fail(`a decoded ${FILAMENT_SPRITES[index].label}`, read.reason);
    }
    return read.sprite;
  });

  const draws = imageDraws(calls);
  let strip: number | null = null;
  const motes = new Map<Hex, number>();
  for (const [index, draw] of draws.entries()) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    if (strip === null && strips.some((s) => sameAsDrawn(s, pixels))) {
      strip = index;
      continue;
    }
    if (!sameAsDrawn(moteRead.sprite, pixels)) continue;
    for (const hex of [FIRST, SECOND]) {
      if (
        !motes.has(hex) &&
        distance({ x: draw.cx, y: draw.cy }, hexCenter(hex)) <= MOTE_R
      ) {
        motes.set(hex, index);
      }
    }
  }

  if (strip === null) {
    fail(
      "an image draw of a produced filament strip in the frame",
      "the frame drew neither strip",
    );
  }
  for (const hex of [FIRST, SECOND]) {
    const drawn = motes.get(hex);
    if (drawn === undefined) {
      fail(
        `an image draw of ${moteFile} centred within MOTE_R (22) of hex (${hex.q}, ${hex.r})`,
        "no such draw in the frame",
      );
    }
    assertLessThan(
      strip,
      drawn,
      `the position of the strip's draw in the frame's order, against the position of the draw of the mote on hex (${hex.q}, ${hex.r}) it goes under`,
    );
  }
});
