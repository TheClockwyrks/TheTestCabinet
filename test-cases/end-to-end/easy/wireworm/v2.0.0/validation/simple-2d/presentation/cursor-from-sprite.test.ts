// presentation/cursor-from-sprite — the cursor is drawn from the seeded cursor
// art, upright.
//
// specs/assets.md gives `assets/cursor/` "One frame, drawn centered on the
// cursor's position in the player band. It points up and is drawn upright, never
// rotated." Both halves are asserted here, because they are one sentence about
// one body: the frame it is drawn from, and that it is drawn the way up the art
// was made.
//
// THE READING IS THE IMAGE SOURCE ITSELF, NOT THE PIXELS ON THE STAGE. The bitmap
// the build handed the context is held against the seeded PNG read off the
// workspace's own `assets/` tree, so a source that IS the seeded frame matches it
// and a triangle drawn in code does not.
//
// UPRIGHT IS READ OFF THE TRANSFORM THE CONTEXT HELD AT THE CALL, which is the
// only place the answer is. A build draws a sprite by translating to the body's
// centre and drawing the frame about the origin, so the call's own arguments say
// nothing about which way up it went: a rotation and a flip both live in the
// matrix. `b` and `c` carry the rotation and the skew, and the determinant's sign
// carries the flip, so an upright draw is one whose matrix has neither.
//
// The whole board is the empty, quiet one `startPlaying` opens, and the cursor is
// left exactly where it parks it, in the middle of its band: the point is about
// the art the cursor is drawn from, not about where it stands, so nothing is
// posed that the requirement does not name.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startPlaying,
  type Harness,
  type Matrix,
  type SpriteMatch,
} from "../harness";
import { frameName, spriteReader } from "./reading";

/** The one frame specs/assets.md seeds for the cursor. */
const CURSOR_FOLDER = "cursor";
const CURSOR_FRAME = 0;

/**
 * How far off upright a draw may be and still be called upright, as the sine of
 * the angle its matrix turns through.
 *
 * specs/assets.md says the cursor is "drawn upright, never rotated", which fixes
 * no tolerance because it admits of none: the figure here is only room for the
 * arithmetic, since a build composes its own translate with the transform the
 * engine already put on the context. `0.0175` is the sine of one degree — far
 * below anything a player would call a tilt, and orders of magnitude above the
 * rounding of a matrix multiply. The `none` and `structured-2d` suites read the
 * same figure.
 */
const UPRIGHT_MAX = 0.0175;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the cursor from assets/cursor/0.png, upright", async () => {
  startPlaying(h);
  const calls = await drawFrame(h);
  captureStill(h, "cursor");

  // Every `drawImage` of the frame, with the matrix the context held at it: the
  // seeded frame is identified from the source, and the way up from the matrix.
  const read = spriteReader();
  const drawn: { transform: Matrix; match: SpriteMatch }[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.method !== "drawImage") continue;
    if (call.transform === undefined) continue;
    const match = await read(call.args[0]);
    if (match === null) continue;
    drawn.push({ transform: call.transform, match });
  }

  const cursors = drawn.filter(
    (image) =>
      image.match.folder === CURSOR_FOLDER &&
      image.match.index === CURSOR_FRAME,
  );
  assertTrue(
    cursors.length > 0,
    "the cursor drawn from assets/cursor/0.png, the one frame " +
      "specs/assets.md seeds for it — the seeded art this frame drew was " +
      `${drawn.map((image) => frameName(image.match)).join(", ") || "none"}`,
  );

  for (const cursor of cursors) {
    const m = cursor.transform;
    const scale = Math.hypot(m.a, m.b) || 1;
    assertTrue(
      Math.abs(m.b) / scale <= UPRIGHT_MAX &&
        Math.abs(m.c) / Math.hypot(m.c, m.d) <= UPRIGHT_MAX &&
        m.a * m.d - m.b * m.c > 0,
      "the cursor's frame drawn upright and unflipped (specs/assets.md: it " +
        "points up and is drawn upright, never rotated) — the transform the " +
        `context held at the draw was ${JSON.stringify(m)}`,
    );
  }
});
