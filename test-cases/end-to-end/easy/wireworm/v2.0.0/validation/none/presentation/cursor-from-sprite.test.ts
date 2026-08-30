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
// WHAT THAT READING DOES NOT SEE is a turn of some angle between the quarters,
// which reverses neither axis. It squeezes the mapped box instead, so the box a
// square frame lands in stops being square, and that is the second half of the
// reading: the seeded frames are `SPRITE_SIZE` (`32`) square, so an upright draw
// of one lands in a box whose sides are in the ratio the build drew it at, and
// {@link SQUARE_TOLERANCE} allows the build every reasonable choice of that.
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
 * How far the mapped box's sides may differ in length, as a fraction of the
 * longer of them, and still be the box a square frame drawn upright lands in.
 *
 * A seeded frame is `SPRITE_SIZE` (`32`) square (specs/assets.md), and a build
 * choosing to draw the cursor at some other aspect than its art's is a design
 * choice the specification leaves open — so this is generous: a quarter of the
 * longer side, which admits a cursor drawn half again as tall as it is wide. It
 * is not a bound on an angle. What it excludes is the squeeze a turn between the
 * quarter turns produces: a frame turned by a sixth of a turn lands in a box
 * whose sides differ by nearly three quarters, and one turned by an eighth lands
 * in a box with no width at all.
 */
const SQUARE_TOLERANCE = 0.25;

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

  const box = upright[0];
  const longer = Math.max(box.width, box.height);
  assertLessThanOrEqual(
    longer === 0 ? 1 : Math.abs(box.width - box.height) / longer,
    SQUARE_TOLERANCE,
    `the ${SPRITE_SIZE}-square cursor frame blitted into a box of its own ` +
      `proportions rather than one a turn squeezed (specs/assets.md: it points ` +
      `up and is drawn upright, never rotated); it was blitted into a box ` +
      `${box.width.toFixed(1)} wide by ${box.height.toFixed(1)} tall`,
  );
});
