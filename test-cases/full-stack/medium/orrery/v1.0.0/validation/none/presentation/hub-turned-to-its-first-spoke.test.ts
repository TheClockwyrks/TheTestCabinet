// presentation/hub-turned-to-its-first-spoke — the hub turns with the arm's
// rotation, so where the arm points reads off its base.
//
// THE RULE. The Arm hubs row of `specs/assets.md` (The sprites) draws the hub
// "centered on the part's anchor hex and turned to its first spoke".
// `specs/parts.md` says which spoke that is: "The part's rotation names its first
// spoke", the spokes standing "at `base + length * DIRS[d]`". And `specs/field.md`
// fixes what angle a `DIRS` index is on the stage: the six offsets are listed "in
// clockwise order on the stage starting from east", so `DIRS[d]` bears `60 * d`
// degrees clockwise from east — `DIRS[0]` toward East, `DIRS[1]` toward Southeast,
// and so on. So an arm at rotation `d` has its hub turned to `60 * d` degrees.
//
// WHAT IT READS. The rotation in force at the hub's draw, for six arms posed at
// rotations `0` through `5`. A build that never turns its hub passes at rotation
// `0` alone and is read at the other five, which is why all six are posed.
//
// THE CONFIGURATION. `BARE` opened as a bare run — an empty machine, the completion
// switch held off, a live run, an EMPTY FIELD — with six `arm`s, one per rotation,
// length `1`, empty tapes, which "is a rest on every part ... and never faults"
// (`specs/simulation.md`), on six anchors four hexes apart around the field. Four
// apart is three more than a length `1` gripper reaches, so no arm's parts come
// within half a hex pitch of another's anchor, and no two arms share an anchor as
// `specs/parts.md` requires. No mote is on the field.
//
// THE HUB IS FOUND BY ITS OWN PIXELS, never by a path: the draw read for each arm is
// the draw of the committed `hub-arm.png` nearest that arm's anchor hex.
//
// THE TOLERANCE is one degree, which over the `40` units a hub's canvas spans moves
// a corner by less than half a logical unit — under the screen pixel
// `specs/assets.md` (Scale) makes a logical unit at the reference fit.
//
// THE EVIDENCE is the frame holding all six, written before the assertions.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertLength, fail } from "../assert";
import { HEX_PITCH, HUB_PATHS } from "../constants";
import { at, distance, hexCenter, type Hex } from "../field";
import { BARE } from "../fixtures";
import { armPart, solution } from "../formats";
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

/** The degrees one `DIRS` step turns through on the stage (`specs/field.md`). */
const DEGREES_PER_STEP = 60;

/**
 * One anchor per rotation `0` to `5`, four hexes apart on a ring inside the field.
 *
 * Every one is four hexes from the centre of a field of radius `FIELD_R` (`5`), so
 * each arm's gripper hex is on the field at every rotation.
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

it("turns each arm's hub to 60 degrees times its rotation", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution(
      ANCHORS.map((anchor, rotation) =>
        armPart("arm", anchor.q, anchor.r, rotation, 1, []),
      ),
    ),
  });

  const calls = await h.frameCalls();
  await captureStill(h, "turned");

  assertLength(
    (await h.snapshot()).editor.parts,
    ANCHORS.length,
    "the parts the machine holds, so the reading below is about six posed arms",
  );

  const file = assetFile(HUB_PATHS.arm);
  const read = await decodeSprite(file);
  if (read.sprite === null) fail(`a decoded ${file}`, read.reason);

  const drawn: { x: number; y: number; angle: number }[] = [];
  for (const draw of imageDraws(calls)) {
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null || !sameAsDrawn(read.sprite, pixels)) continue;
    drawn.push({ x: draw.cx, y: draw.cy, angle: draw.angle });
  }

  for (const [rotation, anchor] of ANCHORS.entries()) {
    const centre = hexCenter(anchor);
    let nearest: { away: number; angle: number } | null = null;
    for (const hub of drawn) {
      const away = distance({ x: hub.x, y: hub.y }, centre);
      if (nearest === null || away < nearest.away) {
        nearest = { away, angle: hub.angle };
      }
    }
    if (nearest === null || nearest.away > HEX_PITCH / 2) {
      fail(
        `an image draw of ${file} on the anchor hex of the arm at rotation ${rotation}`,
        nearest === null
          ? "the frame drew that file nowhere"
          : `the nearest landed ${nearest.away.toFixed(2)} away`,
      );
    }
    assertAngleNear(
      nearest.angle,
      DEGREES_PER_STEP * rotation,
      ANGLE_TOLERANCE,
      `the degrees the hub of the arm at rotation ${rotation} was turned to`,
    );
  }
});
