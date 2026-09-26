// presentation/mote-sprite-at-native-size — a resting mote's sprite covers the
// `44 x 44` square its hex centre sits in the middle of.
//
// THE RULE. "Every sprite is authored at the canvas its table row states and
// drawn at that size in logical units, centered on the thing it depicts, so
// nothing is scaled at draw time" (`specs/assets.md`, Scale). The Motes row states
// the canvas — `44 x 44` — and what the sprite is centred on: "centered on every
// mote's position, at rest and while carried". `specs/field.md` fixes where a
// resting mote's position is: "At rest a mote sits exactly on a hex center", and
// "The center of hex `(q, r)` on the stage is `hexX(q, r) = FIELD_CX + HEX_PITCH *
// (q + r / 2)`" and "`hexY(q, r) = FIELD_CY + HEX_PITCH * (sqrt(3) / 2) * r`".
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the
// completion switch held off, a live run, an EMPTY FIELD — with one `sol` spawned
// back on `(1, 1)` and nothing else. That hex is chosen because neither of its
// coordinates falls out of the field's centre: `hexX(1, 1)` is `688` and
// `hexY(1, 1)` is `304 + 48 * sqrt(3) / 2`, which is not a whole number, so a
// build that drew every mote at `(FIELD_CX, FIELD_CY)` or that rounded the row
// spacing away lands somewhere else.
//
// THE VERDICT is read off the destination rectangle the draw named, mapped
// through the transform in force at it: its centre is the hex centre and it is
// `MOTE_SPRITE_SIZE` (`44`) on both sides, which is the sprite's own canvas. A
// build that stretched the sprite to the hex, or shrank it, fails on the size; one
// that drew it against a corner rather than a centre fails on the position.
//
// THE TOLERANCE is one logical unit, which `specs/assets.md` (Scale) makes one
// screen pixel at the reference `1280`-pixel fit: a build that snaps a
// destination to whole pixels moves it by less than that, and nothing coarser is
// a placement a player could see.
//
// THE EVIDENCE is the frame the measurement was taken off, written before the
// assertions so a failing check leaves it too.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import { MOTE_R, MOTE_SPRITE_PATHS, MOTE_SPRITE_SIZE } from "../constants";
import { at, hexCenter } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  imagesNear,
  openBareRun,
  spawnMote,
  type Harness,
  type ImageDraw,
} from "../harness";
import { assetFile } from "../assets/files";
import { decodeSprite, sameAsDrawn } from "../assets/sprites";

/** One logical unit: one screen pixel at the reference fit (`specs/assets.md`). */
const PLACEMENT_TOLERANCE = 1;

/** The mote whose sprite is measured, and the hex it rests on. */
const TYPE = "sol";
const SPOT = at(1, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the mote's sprite as a 44 x 44 square centred on hexX, hexY", async () => {
  await openBareRun(h, { challenge: BARE });
  await spawnMote(h, SPOT, TYPE);

  const calls = await h.frameCalls();
  await captureStill(h, "native");

  const file = assetFile(MOTE_SPRITE_PATHS[TYPE]);
  const read = await decodeSprite(file);
  if (read.sprite === null) fail(`a decoded ${file}`, read.reason);

  // The sprite is found by its own pixels rather than by a path, because a
  // bundler may inline a produced PNG and that is still the committed file.
  let sprite: ImageDraw | null = null;
  for (const draw of imagesNear(calls, hexCenter(SPOT), MOTE_R)) {
    const drawn = await h.imagePixels(draw.image.id);
    if (drawn !== null && sameAsDrawn(read.sprite, drawn)) {
      sprite = draw;
      break;
    }
  }
  if (sprite === null) {
    fail(
      `an image draw of ${file} centred within MOTE_R (22) of the mote resting on hex (${SPOT.q}, ${SPOT.r})`,
      "no such draw in the frame",
    );
  }

  const centre = hexCenter(SPOT);
  assertNear(
    sprite.cx,
    centre.x,
    PLACEMENT_TOLERANCE,
    "the stage x the mote's sprite is centred on, against hexX(1, 1)",
  );
  assertNear(
    sprite.cy,
    centre.y,
    PLACEMENT_TOLERANCE,
    "the stage y the mote's sprite is centred on, against hexY(1, 1)",
  );
  assertNear(
    Math.abs(sprite.dw),
    MOTE_SPRITE_SIZE,
    PLACEMENT_TOLERANCE,
    "the width in logical units the mote's sprite was drawn across",
  );
  assertNear(
    Math.abs(sprite.dh),
    MOTE_SPRITE_SIZE,
    PLACEMENT_TOLERANCE,
    "the height in logical units the mote's sprite was drawn across",
  );
});
