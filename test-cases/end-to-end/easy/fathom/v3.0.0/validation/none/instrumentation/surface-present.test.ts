// instrumentation/surface-present — the debug and automation surface is there,
// and it is wired to the game rather than to a plausible-looking object.
//
// `specs/instrumentation.md` makes the surface a deliverable: "Every operation
// this file specifies is a deliverable, and the build installs the finished
// surface on `window.__fathom` as soon as the game has initialized", carrying
// `version` (`FATHOM_DEBUG_VERSION`, `1`) and the operations that file names. So
// the first half of this check is reflection: every operation is present, as a
// function, under the name the specification gives it, and the version reads `1`.
//
// THE SECOND HALF IS THE ONE THAT MATTERS. A surface that answers every call and
// reports a state unconnected to what is on screen passes reflection and fails
// every other point in this suite for reasons that name the wrong mechanic. So
// this drives two poses and reads the result in BOTH places the game shows
// itself: `setMaze` lays a board down and the snapshot reports that board's
// tiles; `setForagerTile` moves the forager fifteen tiles across it, and the
// snapshot reports it there AND the canvas draws it there.
//
// THE CANVAS READING IS ONE-DIRECTIONAL AND SPEC-TRACED. The far anchor starts
// unrevealed — nothing has touched it, which the snapshot says as `u` and
// `specs/overview.md` fixes as "near-black and no brighter than a tenth of full
// brightness". Once the forager is standing on it the tile is lit, which
// `specs/sensing.md` draws "at full brightness", with the forager's own cool glow
// on it (`specs/overview.md`). A tile in that state cannot be as dark as the
// darkest an unrevealed tile is allowed to be, so the ceiling on the one is a
// floor on the other, and no palette figure has to be invented to say so.
//
// WHAT THIS DOES NOT DECIDE. How dark unrevealed fog is drawn is
// `fog/unrevealed-black`'s, and nothing here asserts it. That the schedule, the
// housing and the plankton `setMaze` restores are right is
// `controls/setmaze-houses-predators`' and the `maze/*` points'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { placeForager, poseMaze } from "../fixtures";
import {
  FATHOM_DEBUG_VERSION,
  REQUIRED_OPS,
  captureStill,
  createHarness,
  luminance,
  rgbOf,
  type Harness,
  startPlaying,
} from "../harness";

import { tileCenter, type GridFrame, type Tile, visibilityAt } from "../maze";

/**
 * The board: the forager's own four-tile room, eight tiles of solid rock, and a
 * five-tile room it is posed across into.
 *
 * `H` is where it rests first and `T` the tile `setForagerTile` puts it on. They
 * are fourteen tiles apart — `448` logical units — so `T` is far outside the
 * light pocket at its very widest (`V` reaches `VISION_MIN + VISION_GAIN`, `160`,
 * at `G = 1`) and past the kindle variant's outer circle as well, and the rock
 * between them blocks the light in any case. `T` is therefore unrevealed until
 * the forager is standing on it.
 */
const ART = ["H..." + "#".repeat(8) + "..T.."] as const;

/** Where the rock band starts, as an offset in tiles from `H`. */
const ROCK_OFFSET = 4;

/**
 * The brightest an unrevealed tile may be drawn, per channel-mean.
 *
 * `specs/overview.md`: an unrevealed tile is "no brighter than a tenth of full
 * brightness". A tenth of an eight-bit channel's full `255` is `25.5`. It is used
 * here as the FLOOR the lit tile has to clear: the tile the forager stands on is
 * lit, which `specs/sensing.md` draws at full brightness, and carries the
 * forager and its glow, so it cannot read as dark as the darkest fog is allowed
 * to be.
 */
const FOG_MAX_BRIGHTNESS = 25.5;

/** Ticks run after a pose, so the build has drawn the state it left. */
const SETTLE_TICKS = 2;

/**
 * How far off a tile's center the drawn brightness is read, in logical units.
 *
 * A quarter-tile cross, well inside the `TILE` (`32`) the tile occupies, so every
 * sample is on the tile being read. The brightest of them is what counts: where
 * on its box a build draws the forager's body and where it puts the brightest
 * part of the glow are the build's (`specs/overview.md` leaves the look to it),
 * and a sprite with a dark middle is still a lit tile.
 */
const PROBE_OFFSET = 8;

/** The brightest a tile is drawn, over a small cross about its center. */
async function tileBrightness(
  h: Harness,
  grid: GridFrame,
  tile: Tile,
): Promise<number> {
  const at = tileCenter(grid, tile);
  const points = [
    at,
    { x: at.x + PROBE_OFFSET, y: at.y },
    { x: at.x - PROBE_OFFSET, y: at.y },
    { x: at.x, y: at.y + PROBE_OFFSET },
    { x: at.x, y: at.y - PROBE_OFFSET },
  ];
  const pixels = await h.pixels(points);
  return Math.max(...pixels.map((pixel) => luminance(rgbOf(pixel))));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("installs every documented operation and drives the running game", async () => {
  // Reflection first, and through a read that invokes nothing: a build missing an
  // operation is told which one rather than failing on a call it never had.
  const probed = await h.probe(REQUIRED_OPS);
  assertEqual(
    probed.version,
    FATHOM_DEBUG_VERSION,
    "window.__fathom.version, which specs/instrumentation.md fixes as " +
      "FATHOM_DEBUG_VERSION",
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(
      probed.ops[op],
      "function",
      `typeof window.__fathom.${op}, an operation specs/instrumentation.md ` +
        `requires on the surface`,
    );
  }

  // And now the liveness, driven through the surface alone.
  await startPlaying(h);
  const board = await poseMaze(h, ART);
  const home: Tile = board.mark("H");
  const far: Tile = board.mark("T");
  const rock: Tile = { tx: home.tx + ROCK_OFFSET, ty: home.ty };

  await placeForager(h, home);
  // Full glow, so the pocket the forager carries is at its widest and the reading
  // below is of a tile that is lit rather than merely occupied.
  await h.debug.setBrightness(1);
  await h.advance(SETTLE_TICKS);

  const before = await h.snapshot();
  const beforeLit = await tileBrightness(h, before.grid, far);

  // The pose under test.
  await h.debug.setForagerTile(far.tx, far.ty);
  await h.advance(SETTLE_TICKS);

  const after = await h.snapshot();
  const afterLit = await tileBrightness(h, after.grid, far);
  // Before the assertions, so a failing check still leaves the picture of the
  // state it was reading.
  await captureStill(h, "state");

  // `setMaze` posed a board, and the snapshot reports THAT board.
  assertEqual(
    after.tiles[home.ty]?.[home.tx],
    ".",
    `snapshot().tiles at the posed room's first tile (${home.tx}, ${home.ty})`,
  );
  assertEqual(
    after.tiles[rock.ty]?.[rock.tx],
    "#",
    `snapshot().tiles at (${rock.tx}, ${rock.ty}), the first tile of the ` +
      `posed rock band`,
  );

  // `setForagerTile` moved the forager onto it, and the snapshot says so.
  assertEqual(
    `${before.forager.tx},${before.forager.ty}`,
    `${home.tx},${home.ty}`,
    "the forager's tile before the pose",
  );
  assertEqual(
    `${after.forager.tx},${after.forager.ty}`,
    `${far.tx},${far.ty}`,
    "the forager's tile after setForagerTile",
  );

  // The game's own sensing ran on the posed board: the far tile went from
  // untouched to lit because the forager is standing on it.
  assertEqual(
    visibilityAt(before, far),
    "u",
    `the visibility of (${far.tx}, ${far.ty}) while the forager was fourteen ` +
      `tiles away behind rock`,
  );
  assertEqual(
    visibilityAt(after, far),
    "l",
    `the visibility of (${far.tx}, ${far.ty}) with the forager standing on it`,
  );

  // And the canvas draws it there. A lit tile carrying the forager and its glow
  // cannot read as dark as the darkest an unrevealed tile may be drawn.
  assertGreaterThan(
    afterLit,
    FOG_MAX_BRIGHTNESS,
    `the brightest channel-mean, of 255, over the tile the forager was posed ` +
      `onto — it read ${beforeLit.toFixed(1)} while that tile was unrevealed`,
  );
});
