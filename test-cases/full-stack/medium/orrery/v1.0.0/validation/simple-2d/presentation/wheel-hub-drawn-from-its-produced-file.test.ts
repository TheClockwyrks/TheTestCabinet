// presentation/wheel-hub-drawn-from-its-produced-file — a wheel puts the produced
// hub file on its anchor hex.
//
// THE RULE, from the Wheel hub row of `specs/assets.md`'s sprite table:
// "`assets/sprites/parts/wheel-hub.png` | `48 x 48` | centered on the wheel's
// anchor hex and turned to the wheel's live rotation." The table's preamble fixes
// how it is drawn: each sprite is "authored at the canvas its table row states and
// drawn at that size in logical units, centered on the thing it depicts, so
// nothing is scaled at draw time". And `specs/assets.md`'s closing line is what
// makes this a point: "Every mote, filament, glyph, hub, gripper, mount, and
// aperture on screen is a PRODUCED SPRITE."
//
// WHICH FILE IS DRAWN IS DECIDED BY PIXELS, NEVER BY A PATH. A bundler may inline a
// produced PNG as a `data:` URI and that is still the committed file, so a URL says
// nothing. `Harness.imagePixels` hands back the source a frame drew at its own
// natural size, and `sameAsDrawn` compares that against the two files this build
// committed on the `48 x 48` wheel canvas — the hub and the fixture mount — so the
// verdict names which of them landed on the anchor.
//
// THE HUB IS FOUND BY WHERE IT LANDS. The Wheel hub row puts it "centered on the
// wheel's anchor hex", so the draw this point reads is the one whose centre is on
// that hex — within `ON_POINT` of it — and the rest of the frame is not its
// business. What else a wheel puts on the stage is the ring it is drawn as
// carrying: `specs/assets.md` has "The wheel's spokes out to its fixture ring"
// drawn in code, and a mount on each spoke hex is `48 x 48` on the same canvas.
// Whether a build draws that ring while `clearMotes` has taken the fixture motes
// off the field is a question no sentence of `specs/` answers, and it is not this
// point's: demanding the frame carry ONE wheel-canvas sprite and no other would
// fail a conformant hub on a rule the specification never wrote.
//
// THE RING IS OFF THE FIELD, all the same, so nothing is standing on the anchor
// hex but the hub. The wheel is loaded as the machine before the run starts, so
// `startRun` raises its six fixtures and the bare opener's `clearMotes` takes them
// off again — "removes every mote, fixtures included", the faculty gate
// `specs/instrumentation.md` names for a wheel's fixtures.
//
// THE VERDICT. Exactly one sprite on the `48 x 48` wheel canvas is centered on the
// wheel's anchor hex; its pixels are `wheel-hub.png`; and it covers `48 x 48`
// logical units. Where a build shipped one picture under both wheel names the
// pixels cannot tell the two apart and the file reading is answered by the first
// of them — a defect `assets/wheel-pieces-distinct` owns and reports on its own.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { WHEEL_HUB_PATH, WHEEL_SPRITE_SIZE } from "../constants";
import { distance, hexCenter } from "../field";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  imageDraws,
  openBareRun,
  type Harness,
} from "../harness";
import { WHEEL_SPRITES, assetFile } from "../assets/files";
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

it("draws wheel-hub.png at 48 x 48 on the wheel's anchor hex", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("wheel", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  });

  await h.advance(1);
  await captureStill(h, "wheel");

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.motes ?? [],
    0,
    "the ring is off the field, so the hub is all the wheel puts on it",
  );
  assertEqual(
    posed.editor.parts[0]?.kind,
    "wheel",
    "and the machine is one wheel and nothing else",
  );

  const readings = await decodeProduced(WHEEL_SPRITES);
  const sprites = readings.map((read, index) => {
    if (read.sprite === null) {
      fail(
        `a decoded ${WHEEL_SPRITES[index]?.label ?? "wheel sprite"}`,
        read.reason,
      );
    }
    return read.sprite;
  });

  const drawn: { file: string; x: number; y: number; w: number; h: number }[] =
    [];
  for (const draw of imageDraws(await h.lastCalls())) {
    if (draw.image.width !== WHEEL_SPRITE_SIZE) continue;
    const pixels = await h.imagePixels(draw.image.id);
    if (pixels === null) continue;
    const found = sprites.findIndex((sprite) => sameAsDrawn(sprite, pixels));
    if (found < 0) continue;
    drawn.push({
      file: WHEEL_SPRITES[found]?.file ?? "",
      x: draw.cx,
      y: draw.cy,
      w: Math.round(Math.abs(draw.dw)),
      h: Math.round(Math.abs(draw.dh)),
    });
  }

  const onAnchor = drawn.filter(
    (entry) =>
      distance({ x: entry.x, y: entry.y }, hexCenter(ORIGIN)) <= ON_POINT,
  );
  assertLength(
    onAnchor,
    1,
    "one of the two produced 48 x 48 wheel files is painted centered on the " +
      "wheel's anchor hex, and only one",
  );
  const hub = onAnchor[0];
  assertEqual(
    hub?.file,
    assetFile(WHEEL_HUB_PATH),
    "and the file it paints is wheel-hub.png rather than the fixture mount",
  );
  assertEqual(
    hub?.w,
    WHEEL_SPRITE_SIZE,
    "drawn at its native 48 x 48 canvas, so nothing is scaled at draw time",
  );
  assertEqual(hub?.h, WHEEL_SPRITE_SIZE, "in both directions");
});
