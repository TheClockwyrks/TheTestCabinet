// Wireworm — presentation/cursor-from-sprite: the cursor is drawn from the
// seeded cursor art, upright.
//
// specs/assets.md seeds `assets/cursor/` with `CURSOR_FRAMES` (`1`) frame and
// states what is done with it: "One frame, drawn centered on the cursor's
// position in the player band. It points up and is drawn upright, never
// rotated." Both halves are read here — that the frame is the seeded one, and
// that it is blitted without a flip or a turn — because they are the one rule
// the file states about the cursor's art.
//
// SO THE READING IS THE IMAGE SOURCE AND THE TRANSFORM, NOT THE PIXELS. The
// source is held against the seeded PNG read off the same `assets/` tree the
// build was seeded with, so a source that IS the seeded frame matches it
// exactly and art of the build's own does not. The transform recorded beside
// the call is then read for a reflection or a rotation: an upright blit carries
// no shear terms and positive scales, and any flip or turn shows in them.
//
// THE READING IS THE CURSOR'S OWN BLIT, NOT THE FRAME'S. `startPlaying` leaves
// no node, worm, foe or bolt, but nothing in the specification says the cursor
// is the only bitmap a frame may carry: specs/ui.md lets the lives readout be a
// row of icons, and a build is free to composite a board panel or a cached layer
// through `drawImage`. So the transform is read off the one call whose source IS
// the seeded cursor frame, and whatever else the build drew is left alone.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../../src/constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  drawnImages,
  nearestSeededFrame,
  resetTo,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How far a blitted source may sit from the seeded frame and still BE it: the
 * mean absolute difference over premultiplied RGBA channels, out of `255`.
 * Room for the one lossy step in reading a bitmap back off a canvas, and
 * nothing more; the requirement is identity.
 */
const MATCH_MAX = 1;

/** How far the blit's centre may sit from the cursor's own: half a tile. */
const PLACED_MAX = TILE / 2;

/** The one frame `assets/cursor/` holds. */
const CURSOR_FRAME = 0;

/**
 * How far off upright a draw may be and still be called upright, as the sine of
 * the angle its transform turns through.
 *
 * specs/assets.md says the cursor is "drawn upright, never rotated", which fixes
 * no tolerance because it admits of none: the figure here is only room for the
 * arithmetic, since a build composes its own placement with the fit the engine
 * already put on the context. `0.0175` is the sine of one degree — far below
 * anything a player would call a tilt, and orders of magnitude above the
 * rounding of a matrix multiply. The `none` and `simple-2d` suites read the same
 * figure.
 */
const UPRIGHT_MAX = 0.0175;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blits the seeded cursor frame on the cursor, unflipped and unturned", async () => {
  resetTo(h);
  startPlaying(h);

  h.calls.length = 0;
  await h.advance(1);
  const blits = drawnImages(h);
  // The cursor as the build drew it, resting at the centre of its band.
  captureStill(h, "cursor");

  const { cursor } = h.snapshot();
  assertEqual(h.assetFailures.length, 0, "every seeded frame loaded");

  const near = blits.filter(
    (blit) => Math.hypot(blit.x - cursor.x, blit.y - cursor.y) <= PLACED_MAX,
  );
  const matches = await Promise.all(
    near.map((blit) => nearestSeededFrame(blit.source)),
  );
  const drawn = matches.findIndex(
    (match) =>
      match.folder === "cursor" &&
      match.index === CURSOR_FRAME &&
      match.distance <= MATCH_MAX,
  );
  if (drawn < 0) {
    fail(
      `the cursor, at (${cursor.x}, ${cursor.y}), to be drawn from ` +
        `assets/cursor/${CURSOR_FRAME}.png, blitted within ${PLACED_MAX} ` +
        `units of its centre (specs/assets.md: one frame, drawn centered on ` +
        `the cursor's position in the player band)`,
      near.length === 0
        ? "no bitmap was blitted on the cursor"
        : matches
            .map(
              (match) =>
                `${match.folder}/${match.index} at ${match.distance.toFixed(2)}`,
            )
            .join(", "),
    );
  }

  if (near[drawn].mirrored) {
    fail(
      "the cursor's frame blitted upright (specs/assets.md: it points up and " +
        "is drawn upright, never rotated)",
      "it was blitted under a mirroring transform",
    );
  }

  // The turn, read off the transform the cursor's own blit was made under —
  // the call `near[drawn]` already located, whatever else the frame drew.
  const m = near[drawn].transform;
  const shearX = Math.abs(m.b) / (Math.hypot(m.a, m.b) || 1);
  const shearY = Math.abs(m.c) / (Math.hypot(m.c, m.d) || 1);
  if (Math.max(shearX, shearY) > UPRIGHT_MAX) {
    fail(
      "the cursor's frame blitted under an axis-aligned transform with no " +
        "rotation (specs/assets.md: it points up and is drawn upright, never " +
        "rotated)",
      `blitted under a=${m.a}, b=${m.b}, c=${m.c}, d=${m.d}`,
    );
  }
});
