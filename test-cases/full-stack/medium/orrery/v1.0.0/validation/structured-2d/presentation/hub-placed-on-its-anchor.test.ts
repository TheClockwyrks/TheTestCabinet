// presentation/hub-placed-on-its-anchor — the hub covers the `40 x 40` square its
// anchor hex sits in the middle of, and not the hex its gripper is on.
//
// THE RULE. "Every sprite is authored at the canvas its table row states and drawn
// at that size in logical units, centered on the thing it depicts, so nothing is
// scaled at draw time" (`specs/assets.md`, Scale). The Arm hubs row states the
// canvas — `40 x 40` — and what the hub is centred on: "centered on the part's
// anchor hex". `specs/parts.md` says which hex that is and where the other one is:
// "a base fixed on the anchor hex, a length, and one gripper per spoke at
// `base + length * DIRS[d]`". The gripper has a sprite of its own, on a canvas of
// its own, so a hub drawn out on a spoke is on the wrong hex and the wrong size.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with one `arm` at `(2, -1)`,
// rotation `0`, LENGTH `2`, and an empty tape, which "is a rest on every part ...
// and never faults" (`specs/simulation.md`). The length is `2` so the gripper hex
// stands two pitches away rather than one, and the anchor is `(2, -1)` because
// neither of its stage coordinates is the field's centre: `hexX(2, -1)` is `688`
// and `hexY(2, -1)` is `304 - 48 * sqrt(3) / 2`, which is not a whole number.
// Nothing else is on the field.
//
// THE VERDICT is read off the destination rectangle the draw named, mapped through
// the transform in force at it: its centre against the anchor hex's centre, and its
// two sides against `HUB_SPRITE_SIZE` (`40`). The sides are read back through the
// turn the draw was made under — the row also has the hub "turned to its first
// spoke" — so a hub drawn at an angle is measured across its own canvas rather than
// across the stage.
//
// THE TOLERANCE is one logical unit, which `specs/assets.md` (Scale) makes one
// screen pixel at the reference `1280`-pixel fit.
//
// THE EVIDENCE is the frame the measurement was taken off, written before the
// assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import { HUB_PATHS, HUB_SPRITE_SIZE } from "../constants";
import { at, distance, hexCenter } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
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

/** Where the arm stands, and the length that puts its gripper two pitches out. */
const ANCHOR = at(2, -1);
const LENGTH = 2;

/** The destination rectangle's own two sides, read back through the turn it was drawn under. */
function spanOf(draw: ImageDraw): { across: number; down: number } {
  const radians = (draw.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    across: Math.abs(draw.dw * cos + draw.dh * sin),
    down: Math.abs(draw.dh * cos - draw.dw * sin),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the hub as a 40 x 40 square centred on the arm's anchor hex", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", ANCHOR.q, ANCHOR.r, 0, LENGTH, [])]),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "anchor");

  const file = assetFile(HUB_PATHS.arm);
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
    `the stage x the hub is centred on, against hexX(${ANCHOR.q}, ${ANCHOR.r})`,
  );
  assertNear(
    painted.cy,
    centre.y,
    PLACEMENT_TOLERANCE,
    `the stage y the hub is centred on, against hexY(${ANCHOR.q}, ${ANCHOR.r})`,
  );

  const span = spanOf(painted);
  assertNear(
    span.across,
    HUB_SPRITE_SIZE,
    PLACEMENT_TOLERANCE,
    "the logical units the hub was drawn across its own canvas's width",
  );
  assertNear(
    span.down,
    HUB_SPRITE_SIZE,
    PLACEMENT_TOLERANCE,
    "the logical units the hub was drawn across its own canvas's height",
  );
});
