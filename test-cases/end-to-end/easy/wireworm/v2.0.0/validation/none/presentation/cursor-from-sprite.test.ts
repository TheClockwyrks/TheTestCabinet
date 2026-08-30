// Wireworm — presentation/cursor-from-sprite: the cursor is drawn from the
// seeded cursor art, upright.
//
// specs/assets.md seeds `assets/cursor/` with `CURSOR_FRAMES` (`1`) frame and
// states what is done with it: "One frame, drawn centered on the cursor's
// position in the player band. It points up and is drawn upright, never
// rotated." Both halves are read here — that the frame is the seeded one, and
// that it is blitted without a flip or a quarter turn — because they are the one
// rule the file states about the cursor's art.
//
// SO THE READING IS THE IMAGE SOURCE AND THE BOX IT WAS MAPPED INTO, NOT THE
// PIXELS. The source is held against the seeded PNG read off the same `assets/`
// tree the build was seeded with, so a source that IS the seeded frame matches
// it exactly and art of the build's own does not. The destination box the
// transform mapped that draw into then says which way up it went: a horizontal
// flip reverses the box's corners in `x`, a vertical flip reverses them in `y`,
// and a quarter or half turn reverses one or both — so an upright blit is the
// one whose box runs the same way round as the frame it came from.
//
// A TURN OF SOME ANGLE BETWEEN THE QUARTERS reverses neither axis, so the box
// alone does not see it. The angle is in the transform the context held at the
// call, and that is where it is read: an axis-aligned draw carries zero in the
// matrix's shear terms whatever scale it was drawn at, and a rotation puts the
// sine of its angle there. `simple-2d` and `structured-2d` read the same terms
// against the same {@link UPRIGHT_MAX}, so the one requirement is decided the
// same way on all three engines.
//
// NOTHING ELSE IS ON THE BOARD. `startPlaying` leaves no node, worm, foe or
// bolt, so the cursor resting at its band's centre is the only body drawn.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, fail } from "../assert";
import { SPRITE_SIZE, TILE } from "../constants";
import {
  blitsOfFrame,
  captureStill,
  createHarness,
  drawnFrom,
  startPlaying,
  type Harness,
} from "../harness";
import { blitsNear, describeBlits } from "./reading";

/**
 * How far the blit's centre may sit from the cursor's own, in logical units.
 *
 * Half a tile. specs/assets.md draws the frame "centered on the cursor's
 * position", and how a build inks it inside that box is its own; a blit whose
 * centre left the cursor's own tile is drawn on something else.
 */
const PLACED_MAX = TILE / 2;

/**
 * How far off upright a draw may be and still be called upright, as the sine of
 * the angle its transform turns through.
 *
 * specs/assets.md says the cursor is "drawn upright, never rotated", which fixes
 * no tolerance because it admits of none: the figure here is only room for the
 * arithmetic, since a build composes its own placement with whatever fit the
 * runtime already put on the context. `0.0175` is the sine of one degree — far
 * below anything a player would call a tilt, and orders of magnitude above the
 * rounding of a matrix multiply. The `simple-2d` and `structured-2d` suites read
 * the same figure.
 */
const UPRIGHT_MAX = 0.0175;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("blits the seeded cursor frame on the cursor, unflipped and unturned", async () => {
  await startPlaying(h);

  const blits = await blitsOfFrame(h);
  // The cursor as the build drew it, resting at the centre of its band.
  await captureStill(h, "cursor");

  const { cursor } = await h.snapshot();
  const at = { x: cursor.x, y: cursor.y };
  const drawn = drawnFrom(blits, "cursor", at, PLACED_MAX);
  if (drawn.length === 0) {
    fail(
      `the cursor, at (${cursor.x}, ${cursor.y}), to be drawn from ` +
        `assets/cursor/0.png, blitted within ${PLACED_MAX} units of its ` +
        `centre (specs/assets.md: one frame, drawn centered on the cursor's ` +
        `position in the player band)`,
      describeBlits(blitsNear(blits, at, PLACED_MAX)),
    );
  }

  const upright = drawn.filter((blit) => !blit.flipX && !blit.flipY);
  if (upright.length === 0) {
    fail(
      "the cursor's frame blitted upright (specs/assets.md: it points up and " +
        "is drawn upright, never rotated)",
      drawn
        .map(
          (blit) =>
            `blitted ${blit.flipX ? "horizontally " : ""}` +
            `${blit.flipY ? "vertically " : ""}mirrored`,
        )
        .join(", "),
    );
  }

  // The turn, read off the transform the cursor's own blit was made under.
  const [a, b, c, d] = upright[0].transform;
  const shearX = Math.abs(b) / (Math.hypot(a, b) || 1);
  const shearY = Math.abs(c) / (Math.hypot(c, d) || 1);
  assertLessThanOrEqual(
    Math.max(shearX, shearY),
    UPRIGHT_MAX,
    `the ${SPRITE_SIZE}-square cursor frame blitted under an axis-aligned ` +
      `transform (specs/assets.md: it points up and is drawn upright, never ` +
      `rotated); it was blitted under a=${a}, b=${b}, c=${c}, d=${d}`,
  );
});
