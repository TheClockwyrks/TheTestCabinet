// presentation/closed-gripper-drawn-while-holding — a gripper with a mote in it
// paints `gripper-closed.png`, and the empty one beside it paints the open file.
//
// THE RULE, from the Grippers row of `specs/assets.md`'s sprite table:
// "`assets/sprites/parts/gripper-open.png`, `gripper-closed.png` | `32 x 32` |
// centered on each gripper's live position and turned to that spoke's live angle,
// THE CLOSED SPRITE WHILE THE GRIPPER HOLDS A MOTE AND THE OPEN ONE WHENEVER IT
// HOLDS NONE, so that whether a gripper is holding reads off the field as
// `specs/parts.md` asks." `specs/parts.md` is what asks: "An arm's spokes, its
// length, and whether each gripper is holding are visible."
//
// WHICH FILE IS DRAWN IS DECIDED BY PIXELS, NEVER BY A PATH. A bundler is free to
// inline a small produced PNG as a `data:` URI, and that is still the committed
// file, so a URL says nothing. `Harness.imagePixels` hands back the source a frame
// drew, at its own natural size, and `sameAsDrawn` compares that against the file
// this build committed — so "the closed sprite" means the pixels of
// `assets/sprites/parts/gripper-closed.png`.
//
// THE WORLD IS ONE ARM WITH TWO GRIPPERS. A `biarm` is "Two grippers, on opposite
// spokes" (`specs/parts.md`), so at rotation `0` and length `1` its grippers stand
// on `base + DIRS[0]` and `base + DIRS[3]`. One mote is spawned on the first
// gripper's hex and that gripper is given its hold with `setGrip`, "which takes
// hold with no `grab` ever running" (`specs/instrumentation.md`), so no cycle runs
// at all and the second gripper holds nothing. The two grippers therefore differ
// in exactly the one thing the rule names, on one arm, on one frame.
//
// THE VERDICT. The holding gripper's hex carries a `32 x 32` sprite whose pixels
// are `gripper-closed.png`; the empty gripper's hex carries one whose pixels are
// `gripper-open.png`. A build that painted one file whatever a gripper holds fails
// one of the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIPPER_PATHS, GRIPPER_SPRITE_SIZE } from "../constants";
import { distance, hexCenter, type Hex } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  heldBy,
  imageDraws,
  openBareRun,
  partIds,
  spawnMote,
  takeGrip,
  type Harness,
} from "../harness";
import { GRIPPER_SPRITES, assetFile } from "../assets/files";
import { decodeProduced, sameAsDrawn } from "../assets/sprites";
import { gripperHex } from "../parts";

/** The biarm's two spokes at rotation `0`, as `specs/parts.md` tabulates them. */
const HOLDING_SPOKE = 0;
const EMPTY_SPOKE = 3;

/**
 * How near a sprite's centre must land to count as drawn on a hex.
 *
 * `specs/assets.md` draws every sprite "centered on the thing it depicts", and the
 * two gripper hexes are `HEX_PITCH` (`48`) from the anchor in opposite directions,
 * so this span reaches neither the anchor nor the other gripper.
 */
const ON_POINT = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints the closed gripper file on the holding spoke and the open one on the empty spoke", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("biarm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });
  const biarm = (await partIds(h))[0] ?? -1;

  const holding = gripperHex(ORIGIN, HOLDING_SPOKE, 1);
  const empty = gripperHex(ORIGIN, EMPTY_SPOKE, 1);
  const mote = await spawnMote(h, holding, "dust");
  await takeGrip(h, biarm, HOLDING_SPOKE, mote);

  await h.advance(1);
  await captureStill(h, "closed");

  const posed = await h.snapshot();
  assertEqual(
    heldBy(posed, biarm, HOLDING_SPOKE),
    mote,
    "the gripper on spoke 0 holds the mote, so the closed sprite is what it must paint",
  );
  assertEqual(
    heldBy(posed, biarm, EMPTY_SPOKE),
    null,
    "and the gripper on spoke 3 holds nothing, so it must paint the open one",
  );

  const readings = await decodeProduced(GRIPPER_SPRITES);
  const sprites = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(
        `a decoded ${GRIPPER_SPRITES[index]?.label ?? "gripper"}`,
        read.reason,
      );
    }
    return read.sprite;
  });

  // Every gripper-sized source the frame drew, matched to the file it came from.
  const drawn: { x: number; y: number; file: string; size: number }[] = [];
  for (const draw of imageDraws(await h.lastCalls())) {
    if (draw.image.width !== GRIPPER_SPRITE_SIZE) continue;
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const found = sprites.findIndex((sprite) => sameAsDrawn(sprite, pixels));
    if (found < 0) continue;
    drawn.push({
      x: draw.cx,
      y: draw.cy,
      file: GRIPPER_SPRITES[found]?.file ?? "",
      size: Math.round(Math.abs(draw.dw)),
    });
  }

  const on = (hex: Hex): typeof drawn =>
    drawn.filter(
      (entry) =>
        distance({ x: entry.x, y: entry.y }, hexCenter(hex)) <= ON_POINT,
    );

  const closed = on(holding);
  assertLength(
    closed,
    1,
    "the holding gripper is drawn from one produced gripper file, centered on its hex",
  );
  assertEqual(
    closed[0]?.file,
    assetFile(GRIPPER_PATHS.closed),
    "and the file it draws is gripper-closed.png, because that gripper holds a mote",
  );
  assertEqual(
    closed[0]?.size,
    GRIPPER_SPRITE_SIZE,
    "drawn at its native 32 x 32 canvas, so nothing is scaled at draw time",
  );

  const opened = on(empty);
  assertLength(
    opened,
    1,
    "the empty gripper is drawn from one produced gripper file too",
  );
  assertEqual(
    opened[0]?.file,
    assetFile(GRIPPER_PATHS.open),
    "and its file is gripper-open.png, because it holds none",
  );
});
